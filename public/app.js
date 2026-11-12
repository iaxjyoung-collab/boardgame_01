/* Local client: the server remains the authority for every operation. */
"use strict";
const { FACTIONS: F, CARDS, MAP, RULES } = window.COLD;
const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let clockOffset = 0;
let s = { status: "lobby", players: [], me: null },
  selected = 0,
  tool = "gather",
  busy = false,
  pending = null,
  lastToken = "",
  noticeTimer;
let d = {
  count: 1,
  from: 7,
  to: 0,
  via: 1,
  structure: "tower",
  target: "",
  target1: 1,
  target2: "",
  supply: 0,
  cardId: "",
  pick: "from",
  dipTarget: "",
  kind: "pact",
  giveSupply: 0,
  giveIntel: 0,
  wantSupply: 0,
  wantIntel: 0,
};
let token = "";
try {
  token = localStorage.getItem("cold-static-seat") || "";
} catch {}
const socket = io({ reconnection: true });
const person = (id) => s.players.find((p) => p.id === id),
  me = () => person(s.me?.id),
  name = (id) => person(id)?.name || "Unclaimed",
  faction = (id) => F[person(id)?.faction],
  total = (n) => Object.values(n.units).reduce((a, b) => a + b, 0);
const distance = (a, b) =>
  Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs(a.q + a.r - b.q - b.r),
  );
function notify(msg, bad = false) {
  $("notice").textContent = msg;
  $("notice").className = "visible" + (bad ? " bad" : "");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($("notice").className = ""), 6500);
}
function saveToken(t) {
  token = t;
  try {
    localStorage.setItem("cold-static-seat", t);
  } catch {
    notify(
      "Browser storage is unavailable. Copy your private reconnect token from the header.",
      true,
    );
  }
  lastToken = t;
}
function id() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function send(action) {
  if (busy || !socket.connected) return;
  pending = { id: id(), version: s.version, action };
  transmit();
}
function transmit() {
  if (!pending || busy || !socket.connected) return;
  busy = true;
  render();
  socket.timeout(8000).emit("action", pending, (err, result) => {
    busy = false;
    if (err) {
      notify(
        "No confirmation yet. Reconnect or use Retry; your operation will apply at most once.",
        true,
      );
    } else {
      pending = null;
      if (!result.ok) notify(result.error, true);
    }
    render();
  });
}
function join(a) {
  busy = true;
  render();
  socket.timeout(8000).emit("join", a, (err, r) => {
    busy = false;
    if (err)
      notify("Could not reach the host. Check your Wi-Fi and retry.", true);
    else if (r.ok) {
      saveToken(r.token);
      if (pending) transmit();
    } else {
      notify(r.error, true);
    }
    render();
  });
}
socket.on("connect", () => {
  if (token) join({ token });
  else render();
});
socket.on("disconnect", () => render());
socket.on("state", (state) => {
  const before = s;
  s = state;
  if (state.serverTime) clockOffset = state.serverTime - Date.now();
  if (s.battle?.id !== before.battle?.id) {
    d.cardId = "";
    d.supply = 0;
  }
  if (
    s.me &&
    (!before.me || (s.status === "playing" && before.status === "lobby"))
  ) {
    const home = MAP.find(
      (n) => n.home === s.players.findIndex((p) => p.id === s.me.id),
    );
    selected = home?.id || 0;
    d.from = selected;
    d.to = MAP[selected].links[0];
  }
  render();
});
function header() {
  return `<header><div><div class="brand">COLD <span>STATIC</span><span aria-hidden="true"> /</span></div><div class="brand-sub">HOLD THE SIGNAL · OWN THE CITY</div></div><div class="header-actions"><span class="connection ${socket.connected ? "" : "off"}">● ${socket.connected ? "LOCAL CHANNEL OPEN" : "RECONNECTING…"}</span>${pending && !busy ? '<button data-do="retry">Retry last request</button>' : ""}<button data-do="rules">Field manual</button>${s.me ? '<button data-do="seat">My seat token</button>' : ""}${s.me && s.status !== "lobby" ? '<button data-do="diplomacy">Back channels</button>' : ""}</div></header>${!socket.connected ? '<div class="offline-banner">Connection lost. Keep this page open; your crew will reconnect automatically when the host returns.</div>' : ""}`;
}
const motif = `<div class="motif" aria-hidden="true"><svg viewBox="0 0 600 190"><path d="M0 150H65V105H90V150H120V40H164V150H196V90H212V150H245V60H280V150H310V20H328V150H345V100H380V150H415V50H470V150H495V85H525V150H600" fill="#213b43" stroke="#517575"/><path d="M0 170L600 130M60 190L580 80" stroke="#60d0ba" stroke-width="3"/><path d="M290 75V5M250 28Q290 -4 330 28M235 12Q290 -25 345 12" stroke="#e3716d" fill="none" stroke-width="3"/><text x="34" y="80" fill="#dfdfce" font-size="42" font-weight="900" transform="rotate(-8 34 80)">NO SIGNAL.</text></svg></div>`;
function opt(value, label, current, disabled = false) {
  return `<option value="${esc(value)}" ${String(value) === String(current) ? "selected" : ""} ${disabled ? "disabled" : ""}>${esc(label)}</option>`;
}
function field(key, label, html) {
  return `<label for="${key}">${label}</label>${html}`;
}
function select(key, label, options) {
  return field(
    key,
    label,
    `<select id="${key}" data-field="${key}">${options}</select>`,
  );
}
function number(key, label, min, max) {
  return field(
    key,
    label,
    `<input id="${key}" data-field="${key}" type="number" min="${min}" max="${max}" value="${esc(d[key])}">`,
  );
}
function nodeOptions(current, filter = () => true) {
  return MAP.filter(filter)
    .map((n) => opt(n.id, n.name + (n.site ? " ★" : ""), current))
    .join("");
}
function lobby() {
  const p = me();
  return `<main class="lobby"><section><div class="eyebrow">CITY DOSSIER // 06 CREWS // 08 ROUNDS</div><h1>COLD<span>STATIC</span></h1><p class="intro">The occupation is over.<br>The city is still up for grabs.</p>${motif}<p class="intro">Tag the streets. Control the broadcast. Make a pact worth breaking.</p><div class="note"><b>Your objective:</b> hold 3 of the city’s 5 Broadcast Sites, or 4 with a formal ally. Announce your attempt before your last action.</div><p class="muted">6 players · 180–240 minutes · shared local Wi-Fi</p><button data-do="rules">Read the field manual ↗</button>${s.me ? `<div class="panel host-mini"><h3>Connection briefing</h3>${s.isHost ? `<p>Other laptops join at:</p>${(s.addresses?.lan || []).map((a) => `<p><b>${esc(a)}</b></p>`).join("") || "<p>Find your Wi-Fi IPv4 address with ipconfig.</p>"}<p class="muted">Keep the server terminal open.</p>` : "<p>Everyone opens the same host address in their own browser. Keep this browser to preserve your private seat.</p>"}</div>` : ""}</section><section class="panel"><div class="panel-heading"><h2>${p ? "Crew assembly" : "Establish a channel"}</h2><span class="eyebrow">${s.players.length}/6 SEATED</span></div>${!p ? `<p class="muted">${s.status === "lobby" ? "Choose a callsign to take your seat." : "A match is in progress. Restore your existing seat below."}</p>${s.status === "lobby" ? `<form id="join-form"><label for="callsign">Callsign</label><input id="callsign" name="name" maxlength="24" required autocomplete="nickname" placeholder="Your name"><button class="primary wide" ${busy ? "disabled" : ""}>Join the city →</button></form>` : ""}<details><summary>Restore a seat / switch browser</summary><form id="restore-form"><label for="restore-token">Private reconnect token</label><input id="restore-token" name="token" autocomplete="off" required><button class="wide" ${busy ? "disabled" : ""}>Restore my crew</button></form></details>${token ? '<button class="small wide" data-do="forget">Forget this browser’s saved seat</button>' : ""}<hr>` : ""}<div class="seat-list">${Array.from(
    { length: 6 },
    (_, i) => {
      const x = s.players[i],
        f = F[x?.faction];
      return x
        ? `<div class="seat-row" style="--crew:${f.color}"><span class="badge">${f.short}</span><div class="seat-text"><b>${esc(x.name)}${x.id === p?.id ? " · YOU" : ""}</b><small>${f.name} · ${x.online ? "connected" : "offline"}</small></div>${s.isHost && x.id !== p?.id && !x.online ? `<button class="small" data-remove="${x.id}">Remove</button>` : ""}</div>`
        : `<div class="seat-row empty"><span class="badge" style="--crew:#35494e">0${i + 1}</span> Awaiting crew</div>`;
    },
  ).join("")}</div>${
    p
      ? `<div class="lobby-controls">${select(
          "faction",
          "Your faction",
          F.map((f, i) =>
            opt(
              i,
              f.name,
              p.faction,
              s.players.some((x) => x.id !== p.id && x.faction === i),
            ),
          ).join(""),
        )}<p class="note">${F[p.faction].ability}</p>${s.isHost ? `<div class="eyebrow">HOST CONTROL</div><label for="duration">Match timer</label><select id="duration" data-host-duration>${[180, 210, 240].map((v) => opt(v, `${v} minutes`, s.duration)).join("")}</select><p class="muted">Everyone gets to finish the current round when time runs out.</p><button class="primary wide" data-do="start" ${s.players.length !== 6 || s.players.some((p) => !p.online) || busy ? "disabled" : ""}>Start operation →</button>${s.players.length !== 6 ? '<p class="why">Waiting for all six crews.</p>' : s.players.some((p) => !p.online) ? '<p class="why">All six crews must be connected to start.</p>' : ""}` : `<details><summary>Are you hosting?</summary><p class="muted">Enter the host code printed in the server terminal.</p><form id="host-form"><label for="host-code">Host code</label><input id="host-code" name="code" autocomplete="off" required><button class="wide" ${busy ? "disabled" : ""}>Claim host control</button></form></details><p class="muted">The host starts when all six crews are ready.</p>`}</div>`
      : ""
  }</section></main>`;
}
function cityMap() {
  const nodes = s.nodes || [];
  return `<div class="map-panel"><div class="map-heading"><div><h2>The divided city</h2><p>SECTOR 19 / SCROLL TO PAN</p></div><span class="eyebrow">${s.standings?.reduce((a, g) => a + g.sites, 0) || 0}/5 SITES HELD</span></div><div class="map-viewport"><svg class="city-map" viewBox="0 0 940 735" role="group" aria-label="City map. Select a district to inspect it or plan an operation."><defs><pattern id="grid" width="37" height="32" patternUnits="userSpaceOnUse"><path d="M37 0H0V32" fill="none" stroke="#47616a" stroke-width=".5" opacity=".25"/></pattern></defs><rect width="940" height="735" fill="url(#grid)"/><g fill="none" stroke="#38505b" stroke-width="2">${MAP.flatMap((n) => n.links.filter((i) => i > n.id).map((i) => `<path d="M${n.x} ${n.y}L${MAP[i].x} ${MAP[i].y}"/>`)).join("")}</g><path d="M70 650L875 70M65 668L890 80" fill="none" stroke="#345b68" stroke-width="5" opacity=".25"/><text x="650" y="665" fill="#4c6a71" font-size="13" font-family="monospace" letter-spacing="4">THE FLOODLINE</text>${MAP.map(
    (m) => {
      const n = nodes[m.id],
        owner = person(n.owner),
        f = F[owner?.faction],
        color = f?.color || "#61757d",
        sel = selected === m.id;
      return `<g id="district-${m.id}" class="map-node ${sel ? "selected" : ""}" data-node="${m.id}" tabindex="0" role="button" aria-label="${esc(m.name)}, ${m.site ? "Broadcast Site, " : ""}${esc(owner?.name || "neutral")}, ${total(n)} operatives" transform="translate(${m.x} ${m.y})"><title>${esc(m.name)} · ${esc(owner?.name || "Neutral")} · ${total(n)} operatives</title><circle class="select-ring" r="40" fill="none" stroke="transparent"/><${m.home >= 0 ? "rect" : "circle"} class="disc" ${m.home >= 0 ? 'x="-28" y="-28" width="56" height="56" rx="3"' : 'r="30"'}/>${m.site ? '<text x="-46" y="5" fill="#efdfaa" font-size="18">★</text>' : ""}<path d="M-27 18L27 5M-22 25L30 12" stroke="${color}" stroke-width="6" opacity=".7"/><text class="tag" y="4" text-anchor="middle" fill="${f?.color || "#b1bdbd"}">${f?.short || (m.site ? "★" : "··")}</text>${Object.entries(
        n.units,
      )
        .filter(([, v]) => v > 0)
        .map(
          ([pid, count], i) =>
            `<g transform="translate(${i * 30 - 13} 30)"><rect x="-10" y="-10" width="27" height="22" rx="2" fill="${faction(pid)?.color || "#ccc"}"/><text x="3" y="6" fill="#0a181b" font-size="15" font-weight="800" text-anchor="middle">${count}</text></g>`,
        )
        .join(
          "",
        )}<text y="66" fill="${sel ? "#fff2c9" : "#c4d0d0"}" font-size="16" font-weight="600" text-anchor="middle">${esc(m.name)}</text>${n.structure ? `<text x="39" y="0" fill="#dfe8da" font-size="16" font-weight="bold">${n.structure === "tower" ? "T" : "M"}</text>` : ""}${Object.entries(
        n.influence,
      )
        .map(
          ([pid, count], i) =>
            `<text x="-45" y="${i * 17}" fill="${faction(pid)?.color}" font-size="14">${faction(pid)?.short} ${count}/2</text>`,
        )
        .join("")}</g>`;
    },
  ).join(
    "",
  )}</svg></div><div class="legend"><span><b>★</b> Broadcast Site</span><span><b>□</b> Protected hideout</span><span><b>T</b> Tower · <b>M</b> Mural</span><span>Numbers = operatives</span></div></div>`;
}
function roster() {
  return `<aside class="roster"><div class="eyebrow">CREW FREQUENCIES</div>${s.players
    .map((p, i) => {
      const f = F[p.faction],
        ns = s.nodes.filter((n) => n.owner === p.id),
        sites = ns.filter((n) => MAP[n.id].site).length;
      return `<div class="crew ${i === s.turn && s.status === "playing" ? "active" : ""}" style="--crew:${f.color}"><div class="crew-top"><b>${esc(p.name)}</b><span>${p.id === s.me.id ? '<span class="pill">YOU</span>' : p.online ? "" : '<span class="pill red">OFFLINE</span>'}</span></div><div class="crew-name">${f.name}</div><div class="crew-data">${p.supply} SUP · ${p.intel} INT · ${sites}★<br><span class="pips" aria-label="${p.actions} actions remaining">${"●".repeat(p.actions || 0)}${"○".repeat(3 - (p.actions || 0))}</span> · ${p.handCount === null ? "sealed hand" : p.handCount + " cards"}</div>${p.ally ? `<div class="pill">Pact: ${esc(name(p.ally))}</div>` : ""}${p.signal ? '<div class="pill">SIGNAL ATTEMPT</div>' : ""}${p.barredRound === s.round ? '<div class="pill red">PACT WIN BARRED</div>' : ""}<div class="crew-ability">${f.ability}</div></div>`;
    })
    .join(
      "",
    )}<div class="note">Solo: <b>3 sites</b><br>Pact: <b>4 sites</b>, at least 1 each.<br>Announce before your final action.</div>${s.isHost ? `<details class="host-mini"><summary>Host controls</summary><p class="muted">Pass an offline active crew after 60 seconds. Combat waits for both players to return.</p><button class="small wide" data-do="skip">Pass disconnected turn</button><button class="danger small wide" data-do="reset">Reset to lobby</button></details>` : ""}</aside>`;
}
function battle() {
  const b = s.battle;
  if (!b) return "";
  const p = me(),
    fighter = [b.attacker, b.defender].includes(p.id),
    locked = b.locked.includes(p.id);
  return `<section class="battle-box"><div class="eyebrow">ENCRYPTED CONFLICT</div><h2>${MAP[b.to].name}</h2><p>${esc(name(b.attacker))} attacks with ${b.count} operatives. ${esc(name(b.defender))} defends with ${s.nodes[b.to].units[b.defender]}.</p>${[b.attacker, b.defender].map((pid) => `<div class="battle-crew"><b>${esc(name(pid))}</b><span>${b.locked.includes(pid) ? "● LOCKED" : "○ DECIDING"}</span></div>`).join("")}${fighter ? (locked ? `<p class="locked">Your lock: ${b.own.supply} Supply${b.own.card ? ` + ${CARDS[b.own.card.kind].name}` : "; no card"}. Waiting for your opponent.</p>` : `${number("supply", "Secret Supply commitment", 0, Math.min(3, p.supply))}${select("cardId", "Secret Operation card", opt("", "No card", d.cardId) + s.me.hand.map((c) => opt(c.id, `${CARDS[c.kind].name} — ${CARDS[c.kind].text}`, d.cardId)).join(""))}<p class="muted">Defender wins ties. Supply is spent even if you lose. Locking cannot be undone.</p><button class="danger wide" data-do="commit" ${busy || !socket.connected ? "disabled" : ""}>Lock private commitment</button>`) : '<p class="note">Street operations and diplomacy pause until both combatants lock. Their commitments remain private.</p>'}</section>`;
}
function request() {
  const a = { type: tool, node: selected };
  if (tool === "move")
    Object.assign(a, {
      from: Number(d.from),
      to: Number(d.to),
      count: Number(d.count),
      via: Number(d.via),
    });
  if (tool === "recruit") a.count = Number(d.count);
  if (tool === "build") a.structure = d.structure;
  if (tool === "spread")
    a.targets = [
      Number(d.target1),
      ...(d.target2 !== "" ? [Number(d.target2)] : []),
    ];
  if (tool === "scan") a.target = d.target;
  return a;
}
function validity(a) {
  const p = me(),
    n = s.nodes[selected],
    hostile = (n) =>
      Object.entries(n.units).some(([id, v]) => id !== p.id && v > 0),
    own = (n) => n.owner === p.id && !hostile(n),
    taggable = (n) =>
      MAP[n.id].home < 0 && n.owner !== p.id && (!p.ally || n.owner !== p.ally);
  if (!socket.connected) return "Reconnect to the host to act.";
  if (busy) return "Sending your request…";
  if (s.status !== "playing") return "The match has ended.";
  if (s.battle) return "Waiting for the battle commitments.";
  if (s.players[s.turn].id !== p.id)
    return `Waiting for ${name(s.players[s.turn].id)}. You can use Back channels.`;
  if (!p.actions) return "No actions remaining this round.";
  switch (a.type) {
    case "recruit":
      if (!own(n))
        return "Select a controlled district without enemy operatives.";
      if (!Number.isInteger(a.count) || a.count < 1 || a.count > 3)
        return "Recruit 1–3 operatives.";
      if (
        s.nodes.reduce((sum, n) => sum + (n.units[p.id] || 0), 0) + a.count >
        12
      )
        return "You can deploy at most 12 operatives.";
      if (p.supply < a.count) return "Not enough Supply.";
      break;
    case "move": {
      const from = s.nodes[a.from],
        to = s.nodes[a.to];
      if (!from || !to || from === to)
        return "Choose different origin and destination districts.";
      if (
        !Number.isInteger(a.count) ||
        a.count < 1 ||
        a.count > (from.units[p.id] || 0)
      )
        return "Choose operatives present at your origin.";
      if (MAP[to.id].home >= 0 && to.owner !== p.id)
        return "Other crews’ hideouts are protected.";
      if (p.ally && to.units[p.ally])
        return "Allies cannot share occupied districts.";
      if (!MAP[from.id].links.includes(to.id)) {
        const via = s.nodes[a.via];
        if (
          p.faction !== 3 ||
          p.used.courier ||
          !via ||
          !MAP[from.id].links.includes(via.id) ||
          !MAP[via.id].links.includes(to.id) ||
          MAP[via.id].home >= 0 ||
          via.owner === p.id ||
          via.owner === p.ally
        )
          return "Choose an adjacent destination or a legal unused Courier crossing.";
      }
      break;
    }
    case "tag":
      if (!taggable(n))
        return "Select an enemy or neutral district, outside a hideout.";
      if (hostile(n)) return "Clear enemy operatives first.";
      if (
        !n.units[p.id] &&
        !(
          p.faction === 0 &&
          !p.used.tag &&
          total(n) === 0 &&
          MAP[n.id].links.some((i) => s.nodes[i].units[p.id])
        )
      )
        return "Your operatives must be here; Underprint can tag an adjacent empty district once per round.";
      if (p.supply < 1) return "Need 1 Supply.";
      break;
    case "build":
      if (!own(n))
        return "Select a controlled district without enemy operatives.";
      if (n.structure) return "This district already has a structure.";
      if (p.supply < buildCost()) return `Need ${buildCost()} Supply.`;
      break;
    case "spread":
      if (!own(n) || n.structure !== "mural")
        return "Select one of your operational murals on the map.";
      if (n.spreadRound === s.round)
        return "This mural already spread this round.";
      if (p.supply < 1) return "Need 1 Supply.";
      if (a.targets.length === 2 && (p.faction !== 4 || p.used.choir))
        return "Only an unused Choir ability can spread twice.";
      if (new Set(a.targets).size !== a.targets.length)
        return "Choose different target districts.";
      if (
        a.targets.some(
          (i) =>
            !s.nodes[i] ||
            !MAP[n.id].links.includes(i) ||
            total(s.nodes[i]) ||
            !taggable(s.nodes[i]),
        )
      )
        return "Targets must be adjacent, empty, non-allied districts outside hideouts.";
      break;
    case "scan": {
      const op = person(a.target);
      if (!own(n) || n.structure !== "tower")
        return "Select one of your operational surveillance towers.";
      if (!op || op.id === p.id || op.id === p.ally)
        return "Choose an enemy crew.";
      if (
        !s.nodes.some(
          (t) =>
            t.units[op.id] > 0 &&
            distance(MAP[n.id], MAP[t.id]) <= (p.faction === 1 ? 2 : 1),
        )
      )
        return "No target operatives within tower range.";
      if (p.intel < 1) return "Need 1 Intel.";
      break;
    }
    case "explore":
      if (s.me.hand.length >= 3) return "Your hand is full (3 cards).";
      if (p.intel < 1) return "Need 1 Intel.";
      break;
  }
  return "";
}
function buildCost() {
  const p = me();
  return (
    3 +
    (s.event?.kind === "build" ? 1 : 0) -
    (p.faction === 2 && !p.used.build ? 1 : 0)
  );
}
function signalReason() {
  const p = me();
  if (!socket.connected) return "Reconnect to announce.";
  if (busy) return "Sending your request…";
  if (s.status !== "playing") return "The match has ended.";
  if (p.signal)
    return "Your attempt is public; hold the sites until the round ends.";
  if (!p.actions) return "Announce before taking your final action.";
  if (p.ally) {
    const ally = person(p.ally);
    if (p.barredRound === s.round || ally.barredRound === s.round)
      return "Betrayal prevents a shared victory this round.";
    if (!ally.actions)
      return "A shared attempt must be announced while both partners have actions left.";
  }
  return "";
}
function actionForm() {
  const p = me(),
    n = s.nodes[selected],
    m = MAP[selected];
  const titles = {
    gather: "Gather resources",
    move: "Move operatives",
    tag: "Tag district",
    build: "Build structure",
    recruit: "Recruit operatives",
    spread: "Spread influence",
    explore: "Explore intelligence",
    scan: "Scan a crew",
    pass: "Pass your action",
  };
  let form = "",
    cost = "",
    help = "";
  if (tool === "move") {
    form = `<div class="row"><button data-pick="from" class="${d.pick === "from" ? "primary" : ""}">Pick origin</button><button data-pick="to" class="${d.pick === "to" ? "primary" : ""}">Pick destination</button></div>${select("from", "Origin", nodeOptions(d.from))}${select("to", "Destination", nodeOptions(d.to))}${number("count", "Operatives to move", 1, 12)}${p.faction === 3 ? select("via", "Courier crossing (only for a two-step move)", nodeOptions(d.via)) : ""}`;
    cost = "1 action · no resource cost";
    help =
      "Click the map to pick your origin and destination. Enemy operatives trigger combat; ownership changes only with Tag.";
  }
  if (tool === "recruit") {
    form = number("count", "Operatives to recruit", 1, 3);
    cost = `1 action · ${Number(d.count) || 0} Supply`;
    help =
      "Deploy at any controlled district without hostile operatives. Maximum 12 operatives across the city.";
  }
  if (tool === "build") {
    form = select(
      "structure",
      "Structure",
      opt("tower", "Surveillance tower", d.structure) +
        opt("mural", "Propaganda mural", d.structure),
    );
    cost = `1 action · ${buildCost()} Supply`;
    help =
      "Tower: reveals nearby hand counts and enables Scan. Mural: produces income and enables Spread. One structure per district.";
  }
  if (tool === "tag") {
    cost = "1 action · 1 Supply";
    help =
      "Claim this district and its structure. Enemy operatives must be cleared. Influence markers are removed.";
  }
  if (tool === "spread") {
    form = select(
      "target1",
      "Influence target",
      nodeOptions(d.target1, (m) => MAP[selected].links.includes(m.id)),
    );
    if (p.faction === 4 && !p.used.choir)
      form += select(
        "target2",
        "Optional second Choir target",
        opt("", "No second target", d.target2) +
          nodeOptions(d.target2, (m) => MAP[selected].links.includes(m.id)),
      );
    cost = "1 action · 1 Supply";
    help =
      "A mural adds influence once per round. At two markers, you claim an adjacent empty district.";
  }
  if (tool === "scan") {
    form = select(
      "target",
      "Crew to inspect",
      opt("", "Choose a crew", d.target) +
        s.players
          .filter((x) => x.id !== p.id && x.id !== p.ally)
          .map((x) => opt(x.id, x.name, d.target))
          .join(""),
    );
    cost = "1 action · 1 Intel";
    help = `Inspect one random card from a crew with operatives within ${p.faction === 1 ? "two connections" : "one connection"} of this tower. Your report stays private.`;
  }
  if (tool === "explore") {
    cost = "1 action · 1 Intel";
    help =
      "Draw a private Operation card. Hold up to three. Card draws are the only hidden-information system.";
  }
  if (tool === "gather") {
    cost = `1 action · gain 2 Supply + ${s.event.kind === "gather" ? 2 : 1} Intel`;
    help = "Resources cap at 30 each. Gather now to fund your next operation.";
  }
  if (tool === "pass") {
    cost = "1 action · no resource cost";
    help =
      "Yield this operation. You remain in the game and keep any remaining actions.";
  }
  const reason = validity(request());
  return `<section class="panel action-panel"><div class="eyebrow">${s.players[s.turn]?.id === p.id ? "YOUR OPERATION" : "PLAN YOUR NEXT MOVE"}</div><div class="district-info"><div class="district-name">${esc(m.name)}</div><p>${m.site ? "★ Broadcast Site" : m.home >= 0 ? "Protected hideout" : "Street district"} · ${esc(name(n.owner))}</p><p class="muted">${total(n)} operatives · ${n.structure || "no structure"}${Object.entries(
    n.influence,
  )
    .map(([id, c]) => ` · ${esc(name(id))}: ${c}/2 influence`)
    .join("")}</p></div><div class="tool-grid">${Object.keys(titles)
    .map(
      (t) =>
        `<button data-tool="${t}" class="${tool === t ? "selected" : ""}" aria-pressed="${tool === t}">${{ gather: "Gather", move: "Move", tag: "Tag", build: "Build", recruit: "Recruit", spread: "Spread", explore: "Explore", scan: "Scan", pass: "Pass" }[t]}</button>`,
    )
    .join(
      "",
    )}</div><h2>${titles[tool]}</h2><div class="cost">${cost}</div>${form}<p class="muted" style="margin-top:12px">${help}</p><button id="execute" class="primary wide" data-do="execute" ${reason ? "disabled" : ""}>${titles[tool]} →</button><p id="why" class="why" aria-live="polite">${esc(reason || "Ready. This uses one of your three actions.")}</p><button class="wide" data-do="signal" ${signalReason() ? "disabled" : ""}>${p.signal ? "Signal Attempt announced" : "Announce Signal Attempt"}</button><p class="muted">${esc(signalReason() || "Free. Announce before your final action; your opponents will see it.")}</p></section>`;
}
function cards() {
  return `<section class="panel"><div class="panel-heading"><h3>Your dossiers</h3><span class="private-label">PRIVATE ${s.me.hand.length}/3</span></div><div class="cards">${s.me.hand.map((c) => `<div class="op-card"><b>${CARDS[c.kind].name}</b><p>${CARDS[c.kind].text}</p></div>`).join("") || '<p class="muted">No cards. Explore to draw one.</p>'}</div>${s.me.reports.length ? `<h3 style="margin-top:18px">Intercepts this round</h3>${s.me.reports.map((r) => `<div class="report"><b>${esc(r.target)}</b> · ${r.count} cards at scan<br>${r.card ? CARDS[r.card].name : "Empty hand"}<br><small class="muted">Historical observation; hand may have changed.</small></div>`).join("")}` : ""}</section>`;
}
function game() {
  const p = me(),
    active = s.players[s.turn],
    ended = s.status === "finished";
  return `${ended ? `<section class="ending"><div class="eyebrow">FINAL TRANSMISSION // ${esc(s.result.reason)}</div><h1>${esc(s.result.winners.map((g) => g.names).join(" / ") || "The city remains divided")}</h1><p>${s.result.reason === "Hold the Signal" ? "The broadcast network belongs to the winning crew" + (s.result.winners[0]?.ids.length === 2 ? "s" : "") + "." : "The round is complete. Final territory scores are below."}</p><div class="scores">${s.result.standings.map((g) => `<span>${esc(g.names)}: ${g.score} points${!g.eligible ? " (barred)" : ""}</span>`).join("")}</div></section>` : ""}<div class="stats-strip"><div><div class="eyebrow">ROUND ${String(s.round).padStart(2, "0")} / 08</div><strong>${ended ? "OPERATION COMPLETE" : esc(active.name) + "’s operation"}</strong><small id="clock"></small></div><div class="event"><b>${esc(s.event.name)}</b><small>${esc(s.event.text)}</small></div><div class="resources"><div><b>${p.supply}</b><span>SUPPLY</span></div><div><b>${p.intel}</b><span>INTEL</span></div><div><b>${p.actions}</b><span>ACTIONS</span></div></div></div><main class="game-layout">${roster()}<section class="map-column">${cityMap()}<section class="event-log"><div class="panel-heading"><h3>City wire</h3><span class="eyebrow">PUBLIC TRANSMISSIONS</span></div><div class="log-scroll">${s.log
    .slice()
    .reverse()
    .map(
      (e) =>
        `<div class="log-entry"><small>R${String(e.round).padStart(2, "0")}</small>${esc(e.text)}</div>`,
    )
    .join(
      "",
    )}</div></section></section><aside class="operations-column">${battle()}${actionForm()}${cards()}</aside></main>`;
}
function diplomacy() {
  if (!s.me || s.status === "lobby") return;
  const p = me();
  $("dip-content").innerHTML =
    `<p class="muted">Pacts and trades need acceptance. Offers expire when any crew takes an operation. Diplomacy pauses during combat.</p>${p.ally ? `<div class="note">Pact with <b>${esc(name(p.ally))}</b>. Shared victory needs four sites with at least one each.</div><button class="danger" data-do="break" ${s.battle || p.intel < 2 || s.status !== "playing" ? "disabled" : ""}>Betray pact · pay 2 Intel</button><p class="muted">Your former partner gains 2 Supply. Both of you lose shared-victory eligibility for this round. Either may still win alone.</p>` : ""}<h3 style="margin-top:20px">Private offers</h3>${s.offers.map((o) => `<div class="offer"><b>${esc(name(o.from))} → ${esc(name(o.to))}</b><p>${o.kind === "pact" ? "Formal alliance proposal" : `Offers ${o.giveSupply} Supply + ${o.giveIntel} Intel for ${o.wantSupply} Supply + ${o.wantIntel} Intel`}</p><div class="row">${o.to === p.id ? `<button class="primary" data-accept="${o.id}" ${s.battle ? "disabled" : ""}>Accept</button>` : ""}<button data-cancel="${o.id}" ${s.battle ? "disabled" : ""}>${o.to === p.id ? "Decline" : "Withdraw"}</button></div></div>`).join("") || '<p class="muted">No open offers.</p>'}<hr><h3>Open a back channel</h3>${select(
      "dipTarget",
      "Other crew",
      opt("", "Choose a crew", d.dipTarget) +
        s.players
          .filter((x) => x.id !== p.id)
          .map((x) => opt(x.id, x.name, d.dipTarget))
          .join(""),
    )}${select("kind", "Offer type", opt("pact", "Formal alliance", d.kind) + opt("trade", "Resource trade", d.kind))}${d.kind === "trade" ? `<div class="trade-grid"><div><h3>You give</h3>${number("giveSupply", "Supply", 0, 30)}${number("giveIntel", "Intel", 0, 30)}</div><div><h3>You receive</h3>${number("wantSupply", "Supply", 0, 30)}${number("wantIntel", "Intel", 0, 30)}</div></div>` : '<p class="note">Only two crews per pact. You cannot occupy each other’s territory when signing. Forming a pact clears your previous Signal announcements.</p>'}<button class="primary wide" data-do="offer" ${!d.dipTarget || s.battle || busy || s.status !== "playing" ? "disabled" : ""}>Send private offer</button>`;
}
function render() {
  const focus = document.activeElement?.id,
    ss = document.activeElement?.selectionStart;
  const preserve = {};
  for (const key of ["callsign", "restore-token", "host-code"])
    if ($(key)) preserve[key] = $(key).value;
  $("app").innerHTML =
    header() +
    (s.me && s.status !== "lobby" ? game() : lobby()) +
    "<footer>COLD STATIC / LOCAL NETWORK EDITION / THE STREETS REMEMBER.</footer>";
  for (const [key, val] of Object.entries(preserve))
    if ($(key)) $(key).value = val;
  if (focus && $(focus)) {
    try {
      $(focus).focus({ preventScroll: true });
      if (ss !== null) $(focus).setSelectionRange(ss, ss);
    } catch {}
  }
  if ($("diplomacy").open) diplomacy();
  updateClock();
}
function updateClock() {
  const el = $("clock");
  if (!el || !s.endsAt) return;
  const remaining = s.endsAt - (Date.now() + clockOffset);
  el.textContent =
    s.status === "finished"
      ? "Final broadcast received"
      : remaining <= 0
        ? "TIME LIMIT · finish this round"
        : `${Math.floor(remaining / 60000)}:${String(Math.floor(remaining / 1000) % 60).padStart(2, "0")} until final round check`;
}
setInterval(updateClock, 1000);
$("rules-content").innerHTML = RULES.split("\n\n")
  .map((x) => {
    const i = x.indexOf("\n");
    return `<section class="manual-section"><h3>${esc(x.slice(0, i))}</h3><p>${esc(x.slice(i + 1))}</p></section>`;
  })
  .join("");
document.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target,
    data = new FormData(form);
  if (form.id === "join-form") join({ name: data.get("name") });
  if (form.id === "restore-form")
    join({ token: String(data.get("token")).trim() });
  if (form.id === "host-form")
    send({ type: "host", code: String(data.get("code")).trim() });
});
function selectNode(n) {
  selected = n;
  if (tool === "move") {
    d[d.pick] = n;
    if (d.pick === "from") d.pick = "to";
  }
  if (tool === "spread") {
    d.target1 = MAP[n].links[0];
    d.target2 = "";
  }
  render();
}
document.addEventListener("keydown", (e) => {
  const n = e.target.closest("[data-node]");
  if (n && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    selectNode(Number(n.dataset.node));
  }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("button,[data-node]");
  if (!b) return;
  if (b.dataset.close) {
    $(b.dataset.close).close();
    return;
  }
  if (b.dataset.node !== undefined) {
    selectNode(Number(b.dataset.node));
    return;
  }
  if (b.dataset.tool) {
    tool = b.dataset.tool;
    if (tool === "move") {
      d.from = selected;
      d.pick = "to";
    }
    if (tool === "spread") {
      d.target1 = MAP[selected].links[0];
      d.target2 = "";
    }
    render();
    return;
  }
  if (b.dataset.pick) {
    d.pick = b.dataset.pick;
    render();
    return;
  }
  if (b.dataset.accept) {
    send({ type: "accept", offerId: b.dataset.accept });
    return;
  }
  if (b.dataset.cancel) {
    send({ type: "cancel", offerId: b.dataset.cancel });
    return;
  }
  if (b.dataset.remove) {
    send({ type: "remove", target: b.dataset.remove });
    return;
  }
  switch (b.dataset.do) {
    case "rules":
      $("rules").showModal();
      break;
    case "seat":
      $("seat-token").value = token || lastToken;
      $("seat").showModal();
      break;
    case "forget":
      token = "";
      try {
        localStorage.removeItem("cold-static-seat");
      } catch {}
      location.reload();
      break;
    case "retry":
      transmit();
      break;
    case "diplomacy":
      diplomacy();
      $("diplomacy").showModal();
      break;
    case "execute":
      send(request());
      break;
    case "signal":
      send({ type: "signal" });
      break;
    case "start":
      send({ type: "start" });
      break;
    case "commit":
      send({
        type: "commit",
        battleId: s.battle.id,
        supply: Number(d.supply),
        cardId: d.cardId || null,
      });
      break;
    case "offer":
      send({
        type: "offer",
        target: d.dipTarget,
        kind: d.kind,
        giveSupply: Number(d.giveSupply),
        giveIntel: Number(d.giveIntel),
        wantSupply: Number(d.wantSupply),
        wantIntel: Number(d.wantIntel),
      });
      break;
    case "break":
      if (
        confirm(
          "Betray your ally? Pay 2 Intel; they gain 2 Supply. Both crews lose shared-victory eligibility this round. Either may still win alone.",
        )
      )
        send({ type: "break" });
      break;
    case "reset":
      if (
        confirm(
          "End this match and return all six crews to the lobby? This replaces the saved match.",
        )
      )
        send({ type: "reset" });
      break;
    case "skip":
      send({ type: "skip" });
      break;
  }
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.hostDuration !== undefined) {
    send({ type: "duration", minutes: Number(e.target.value) });
    return;
  }
  const key = e.target.dataset.field;
  if (!key) return;
  if (key === "faction") {
    send({ type: "faction", faction: Number(e.target.value) });
    return;
  }
  d[key] = e.target.value;
  if (e.target.type !== "number") render();
});
document.addEventListener("input", (e) => {
  const key = e.target.dataset.field;
  if (!key) return;
  d[key] = e.target.value;
  if ($("execute")) {
    const reason = validity(request());
    $("execute").disabled = !!reason;
    $("why").textContent =
      reason || "Ready. This uses one of your three actions.";
  }
});
render();
