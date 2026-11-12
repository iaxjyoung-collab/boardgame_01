/* The browser plans operations; only the server can apply them. */
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
let s = { status: "lobby", players: [], me: null },
  selected = 0,
  tool = "gather",
  busy = false,
  pending = null,
  token = "",
  joinStatus = "",
  joinError = "",
  clockOffset = 0,
  guideStep = 0,
  guideDismissed = false,
  guideKey = "",
  lastAnnouncement = "",
  fitMap = false;
const d = {
  moveCount: 1,
  recruitCount: 1,
  from: 7,
  to: "",
  via: "",
  structure: "tower",
  target: "",
  target1: "",
  target2: "",
  supply: 0,
  cardId: "",
  pick: "to",
  dipTarget: "",
  kind: "pact",
  giveSupply: 0,
  giveIntel: 0,
  wantSupply: 0,
  wantIntel: 0,
};
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
const HELP = {
  supply:
    "Supply pays for recruitment, tagging, construction and secret battle commitments. You receive income each round. Maximum 30.",
  intel:
    "Intel pays for drawing Operation cards, scanning opponents and breaking an alliance. Maximum 30.",
  actions:
    "Take one operation, then the next crew acts. You have three operations each round. Free announcements and diplomacy do not use an operation.",
  sites:
    "Stars mark the five Broadcast Sites. Own three to win alone, or four as a pair with at least one each. Announce before your last action; hold until round end.",
  signal:
    "A free public warning that you intend to win this round. Announce while you still have an action; a pair must both have an action left. You still need the required sites at the round end.",
  bots: "Bots occupy the remaining crew seats and follow the same rules. They use only information their crew may see. Add or remove them before starting; they do not replace a connected person.",
  tutorial:
    "Optional guidance during round one. It explains the objective, movement, tagging and turn order. Each player can skip or resume it independently; it never spends actions or changes the rules.",
  tower:
    "A surveillance tower reveals enemy hand counts nearby and lets you spend a Scan operation to inspect a random card. Range one connection; Glass Ministry range two.",
  mural:
    "A propaganda mural adds one Supply to your round income. Spread adds influence to an empty neighbour; two markers claim it. Each mural spreads once per round.",
  influence:
    "Two influence markers from the same crew claim an empty district. A mural adds them with Spread. Operatives block spreading; Tag removes all influence.",
  owner:
    "Graffiti determines ownership. Moving operatives here does not capture it. Use Tag to claim it; towers and murals change hands with ownership.",
  pact: "An accepted alliance pairs two crews. A shared win needs four Broadcast Sites and at least one each. You cannot attack or capture from your ally. Signing clears prior Signal announcements.",
  trade:
    "A trade transfers Supply and Intel only when the recipient accepts. Check the payment and final balances before sending. Resources cannot exceed 30.",
  offers:
    "Offers are private and expire when any crew takes an operation. Bots leave a brief response window for human recipients. An offer is a proposal, not a completed transfer.",
  cards:
    "Only you can see your Operation cards. Play at most one in combat. It is discarded after both sides reveal. Explore draws one card for one Intel; hand limit three.",
  commitment:
    "Both sides secretly lock 0–3 Supply and at most one card. Reveal together. Strength = operatives + Supply + card bonus. Defender wins ties. Locks cannot be changed.",
  reconnect:
    "This browser automatically remembers your private crew token. Copy it to restore your crew on another device. Anyone with the token can control your crew.",
  gather:
    "Gain two Supply and one Intel. Quiet channels adds one more Intel. Costs one operation.",
  move: "Move operatives along one connection. An enemy group starts combat. Movement alone never changes ownership.",
  tag: "Spend one Supply and one operation to claim the selected district. Your operatives must be there and enemies must be cleared. Underprint may tag an adjacent empty district once per round.",
  recruit:
    "Spend one Supply per operative to recruit one to three at a district you control without enemy operatives. Maximum twelve deployed.",
  build:
    "Build a tower or mural for three Supply. One structure per district. Rust Union gets its first build discounted; Concrete rain adds one Supply.",
  spread:
    "Use your mural to add influence to an empty adjacent district for one Supply. Two markers claim it. Choir Zero may once per round select two targets.",
  explore:
    "Spend one Intel and one operation to draw a private Operation card, up to three in hand.",
  scan: "From your operational tower, spend one Intel and one operation to inspect one random enemy card in range. The report is a private historical observation.",
  pass: "Use one operation without taking another action. This does not remove you from the game.",
};
function tip(key, label = key) {
  return `<button type="button" class="help-button" data-help="${key}" aria-label="Help: ${esc(label)}" aria-expanded="false">?</button>`;
}
function notice(message, bad = false) {
  $("notice").textContent = message;
  $("notice").className = "visible" + (bad ? " bad" : "");
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => ($("notice").className = ""), 6500);
}
function announce(message) {
  if (message && message !== lastAnnouncement) {
    $("announcer").textContent = message;
    lastAnnouncement = message;
  }
}
function remember() {
  try {
    localStorage.setItem("cold-static-seat", token);
  } catch {
    notice(
      "Copy your reconnect token: this browser could not save your seat.",
      true,
    );
  }
}
function newId() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function blocked() {
  return busy || !!pending || !socket.connected;
}
function send(action) {
  if (blocked()) return;
  pending = { id: newId(), version: s.version, action };
  transmit();
}
function transmit() {
  if (!pending || busy || !socket.connected) return;
  busy = true;
  render();
  socket.timeout(8000).emit("action", pending, (err, r) => {
    busy = false;
    if (err)
      notice(
        "Confirmation is missing. Retry the pending request before taking another action.",
        true,
      );
    else {
      pending = null;
      if (!r.ok) notice(r.error, true);
    }
    render();
  });
}
function join(a) {
  if (busy) return;
  busy = true;
  joinError = "";
  joinStatus = a.token ? "Restoring your crew…" : "Joining the game…";
  render();
  socket.timeout(8000).emit("join", a, (err, r) => {
    busy = false;
    if (err) {
      joinError = "The host did not respond. Check Wi-Fi, then retry.";
      joinStatus = "";
    } else if (r.ok) {
      token = r.token;
      remember();
      joinStatus = "Crew restored";
      if (pending) transmit();
    } else {
      joinError = r.error;
      joinStatus = "";
    }
    render();
  });
}
socket.on("connect", () => {
  if (token) join({ token });
  else {
    joinStatus = "Connected to host";
    render();
  }
});
socket.on("disconnect", () => {
  joinStatus = "Reconnecting to host…";
  render();
});
function storeGuide() {
  try {
    localStorage.setItem(
      guideKey,
      JSON.stringify({ step: guideStep, dismissed: guideDismissed }),
    );
  } catch {}
}
socket.on("state", (state) => {
  const before = s;
  s = state;
  if (s.serverTime) clockOffset = s.serverTime - Date.now();
  if (s.battle?.id !== before.battle?.id) {
    d.cardId = "";
    d.supply = 0;
    if (s.battle) selected = s.battle.to;
  }
  if (
    s.me &&
    (!before.me || (s.status === "playing" && before.status === "lobby"))
  ) {
    const h = MAP.find(
      (n) => n.home === s.players.findIndex((p) => p.id === s.me.id),
    );
    selected = h?.id ?? 0;
    d.from = selected;
    d.to = "";
  }
  if (s.battle && s.battle.id !== before.battle?.id) selected = s.battle.to;
  if (s.me && s.status !== "lobby") {
    const key = `cold-static-guide:${s.endsAt}:${s.me.id}`;
    if (key !== guideKey) {
      guideKey = key;
      guideStep = 0;
      guideDismissed = false;
      try {
        const saved = JSON.parse(localStorage.getItem(key) || "null");
        if (saved) {
          guideStep = Math.min(4, Math.max(0, saved.step || 0));
          guideDismissed = !!saved.dismissed;
        }
      } catch {}
    }
    const old = before.players.find((p) => p.id === s.me.id);
    if (
      s.round === 1 &&
      guideStep === 2 &&
      !s.battle &&
      ((old && me().actions < old.actions) ||
        (before.battle && me().actions < 3))
    ) {
      guideStep = 3;
      storeGuide();
    }
    if (before.round === 1 && s.round === 2 && s.tutorialEnabled)
      notice("Guided round complete. The game continues with the same rules.");
    if (s.battle && s.battle.id !== before.battle?.id)
      announce(
        `Combat at ${MAP[s.battle.to].name}. Both fighters must lock a commitment.`,
      );
    else if (
      s.status === "playing" &&
      s.players[s.turn]?.id !== before.players[before.turn]?.id
    )
      announce(
        s.players[s.turn].id === s.me.id
          ? `Your turn. ${me().actions} actions remain.`
          : `${name(s.players[s.turn].id)} is taking an operation.`,
      );
    const incoming = s.offers.filter((o) => o.to === s.me.id);
    if (incoming.some((o) => !before.offers?.some((x) => x.id === o.id))) {
      notice("New diplomacy offer. Review it before the next operation.");
      announce("New diplomacy offer received.");
    }
  }
  render();
});
function opt(value, label, current, disabled = false) {
  return `<option value="${esc(value)}" ${String(value) === String(current) ? "selected" : ""} ${disabled ? "disabled" : ""}>${esc(label)}</option>`;
}
function select(key, label, options, help) {
  return `<label for="${key}">${label}${help ? tip(help, label) : ""}</label><select id="${key}" data-field="${key}">${options}</select>`;
}
function number(key, label, min, max) {
  return `<label for="${key}">${label}</label><input id="${key}" data-field="${key}" type="number" min="${min}" max="${max}" step="1" value="${esc(d[key])}">`;
}
function details(key, title, content, open = false) {
  return `<details data-persist="${key}" ${open ? "open" : ""}><summary>${title}</summary><div class="disclosure-content">${content}</div></details>`;
}
function nodeOptions(
  value,
  ids = MAP.map((n) => n.id),
  placeholder = "Choose a district",
) {
  return (
    opt("", placeholder, value) +
    ids
      .map((id) =>
        opt(
          id,
          MAP[id].name + (MAP[id].site ? " · Broadcast Site" : ""),
          value,
        ),
      )
      .join("")
  );
}
function header() {
  const incoming = s.offers?.filter((o) => o.to === s.me?.id).length || 0;
  return `<header><a class="brand" href="#main" aria-label="Cold Static, skip to main">COLD <span>STATIC</span></a><nav aria-label="Game tools">${s.me && s.tutorialEnabled && s.round === 1 ? '<button id="open-guide" data-do="guide">First-round guide</button>' : ""}<button id="open-rules" data-do="rules">Rules</button>${s.me && s.status !== "lobby" ? `<button id="open-diplomacy" data-do="diplomacy">Diplomacy${incoming ? ` <span class="count">${incoming}</span>` : ""}</button>` : ""}${s.me ? `<button id="open-seat" data-do="seat">Reconnect</button>` : ""}<span class="connection ${socket.connected ? "" : "off"}">${socket.connected ? (s.me ? "Crew connected" : "Host connected") : "Reconnecting…"}</span></nav></header>${!socket.connected ? '<div class="offline-banner" role="status">Connection lost. Your crew is saved. Keep this page open while it reconnects.</div>' : ""}${pending ? `<div class="pending-banner" role="status">${busy ? "Sending" : "Awaiting confirmation for"}: <b>${esc(pending.action.type)}</b>. ${!busy ? '<button id="retry-request" data-do="retry">Retry same request</button>' : "Other actions are paused until this request is confirmed."}</div>` : ""}`;
}
function startReason() {
  if (blocked()) return "Wait for the host connection or pending request.";
  if (s.players.length < 6)
    return `Add ${6 - s.players.length} bot${s.players.length === 5 ? "" : "s"} or invite more players.`;
  if (s.players.some((p) => !p.bot && !p.online))
    return "A human player is disconnected. They can rejoin, or the host can remove their seat.";
  return "";
}
function seatRows() {
  const p = me();
  return Array.from({ length: 6 }, (_, i) => {
    const x = s.players[i],
      f = F[x?.faction];
    if (!x)
      return `<div class="seat-row empty"><span class="seat-number">${i + 1}</span><span>Open seat</span></div>`;
    return `<div class="seat-row"><span class="badge" style="--crew:${f.color}">${f.short}</span><div><b>${esc(x.name)}${x.id === p?.id ? " · you" : ""}</b><span class="muted">${f.name} · ${x.bot ? (x.botTakeover ? "Temporary bot" : "Bot") : x.online ? "Human · connected" : "Human · disconnected"}</span></div>${s.isHost && x.id !== p?.id && (x.bot || !x.online) ? `<button id="remove-${x.id}" class="quiet" data-remove="${x.id}" ${blocked() ? "disabled" : ""}>Remove</button>` : ""}</div>`;
  }).join("");
}
function joinPanel() {
  const full = s.players.length === 6,
    canJoin = s.status === "lobby" && !full;
  return `<h2>${canJoin ? "Join the game" : "Restore your crew"}</h2><p class="muted">${canJoin ? "Enter your name to take a seat." : full ? "All six seats are occupied. Restore your crew, or ask the host to remove a bot or disconnected seat." : "A match is underway. Restore your crew below."}</p>${joinStatus ? `<p role="status">${esc(joinStatus)}</p>` : ""}${joinError ? `<p class="error" role="alert">${esc(joinError)}</p>` : ""}${canJoin ? `<form id="join-form"><label for="callsign">Your name</label><input id="callsign" name="name" required maxlength="24" autocomplete="nickname" placeholder="Name or callsign"><button class="primary wide" ${blocked() ? "disabled" : ""}>Join game</button></form>` : ""}${details("restore", "Restore an existing crew", `<p>Use the private token from your original browser’s Reconnect button.</p><form id="restore-form"><label for="restore-token">Private reconnect token</label><input id="restore-token" name="token" required autocomplete="off"><button class="wide" ${busy || !socket.connected ? "disabled" : ""}>Restore crew</button></form>`, !canJoin || !!joinError)}${token ? '<button class="quiet wide" data-do="forget">Clear this browser’s saved token</button><p class="muted">This removes the saved login here; it does not free your crew’s seat.</p>' : ""}`;
}
function hostSetup() {
  const reason = startReason();
  return `<div class="setting-block"><h3>Players ${tip("bots", "Bots")}</h3><p class="muted">Keep six crews on the board. Add standard bots for seats you don’t need. One difficulty; no hidden-information advantage.</p><div class="row"><button id="add-bot" data-do="addBot" ${s.players.length === 6 || blocked() ? "disabled" : ""}>Add one bot</button><button id="fill-bots" data-do="fillBots" ${s.players.length === 6 || blocked() ? "disabled" : ""}>Fill empty seats</button></div></div><div class="tutorial-setting"><label class="check-setting" for="tutorial-enabled"><input type="checkbox" id="tutorial-enabled" data-tutorial ${s.tutorialEnabled ? "checked" : ""} ${blocked() ? "disabled" : ""}><span>Guide us through the first round <span class="muted">Optional. Each player can skip or resume.</span></span></label>${tip("tutorial", "First-round tutorial")}</div><label for="duration">Time limit</label><select id="duration" data-host-duration ${blocked() ? "disabled" : ""}>${[180, 210, 240].map((v) => opt(v, `${v} minutes`, s.duration)).join("")}</select><p class="muted">Finish the current round when the timer ends.</p><button id="start-game" class="primary wide" data-do="start" ${reason ? "disabled" : ""}>Start game</button>${reason ? `<p class="why">${esc(reason)}</p>` : ""}${details("join-address", "Invite another player", `<p>Other laptops on this Wi-Fi open one of these addresses. Choose the address that matches your Wi-Fi adapter in ipconfig; other entries may be virtual adapters or VPNs.</p>${(s.addresses?.lan || []).map((a, i) => `<div class="address-row"><span>${esc(a)}</span><button id="copy-address-${i}" data-copy="${esc(a)}">Copy</button></div>`).join("") || "<p>Use the host’s Wi-Fi IPv4 address and port.</p>"}<p class="muted">Keep the server terminal open during play.</p>`)}`;
}
function setupPanel() {
  const p = me();
  if (!p) return joinPanel();
  return `<h2>${s.isHost ? "Game setup" : "You’re in the lobby"}</h2><p><b>${esc(p.name)}</b> · Human player</p>${select(
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
  )}<p class="ability">${F[p.faction].ability}</p>${s.isHost ? hostSetup() : `<p class="note">The host can fill empty seats with bots and start the game.</p>${details("host-claim", "Host controls", `<p>Enter the host code printed in the server terminal.</p><form id="host-form"><label for="host-code">Host code</label><input id="host-code" name="code" autocomplete="off" required><button class="wide" ${blocked() ? "disabled" : ""}>Claim host controls</button></form>`)}`}`;
}
function lobby() {
  const p = me();
  return `<main id="main" class="lobby"><section class="lobby-intro"><p class="eyebrow">Local strategy game</p><h1>Take the city.<br>Hold the signal.</h1><p>Lead a crew through a divided city. Claim districts, make alliances, and decide who controls the broadcast.</p><div class="objective-card"><h2>One clear objective ${tip("sites", "Winning")}</h2><p>Own <b>3 Broadcast Sites</b> alone, or <b>4 with an ally</b>. Announce your attempt before your last action, then hold until the round ends.</p></div><p class="muted">1–6 people · bots fill the other crew seats<br>180–240 minute timer · play on the same Wi-Fi</p>${p ? `<section class="panel"><div class="panel-heading"><h2>Crews</h2><span>${s.players.length} of 6 seats</span></div>${seatRows()}</section>` : ""}</section><section class="panel setup-panel">${setupPanel()}</section></main>`;
}
function hostile(n, p = me()) {
  return Object.entries(n.units).some(([id, v]) => id !== p.id && v > 0);
}
function owned(n, p = me()) {
  return n.owner === p.id && !hostile(n, p);
}
function taggable(n, p = me()) {
  return (
    MAP[n.id].home < 0 && n.owner !== p.id && (!p.ally || n.owner !== p.ally)
  );
}
function route(fromId, toId) {
  const p = me();
  if (fromId === "" || toId === "" || fromId === toId) return null;
  const from = MAP[Number(fromId)],
    to = MAP[Number(toId)];
  if (
    !from ||
    !to ||
    !(s.nodes[from.id].units[p.id] > 0) ||
    (to.home >= 0 && s.nodes[to.id].owner !== p.id) ||
    (p.ally && s.nodes[to.id].units[p.ally])
  )
    return null;
  if (from.links.includes(to.id)) return { via: null };
  if (p.faction === 3 && !p.used.courier) {
    const via = from.links.find(
      (i) =>
        MAP[i].home < 0 &&
        MAP[i].links.includes(to.id) &&
        s.nodes[i].owner !== p.id &&
        s.nodes[i].owner !== p.ally,
    );
    if (via !== undefined) return { via };
  }
  return null;
}
function legalNodes() {
  const p = me();
  if (!p || s.status === "lobby") return [];
  if (tool === "move")
    return d.pick === "from"
      ? s.nodes.filter((n) => n.units[p.id] > 0).map((n) => n.id)
      : MAP.filter((n) => route(d.from, n.id)).map((n) => n.id);
  if (tool === "tag")
    return s.nodes
      .filter(
        (n) =>
          taggable(n) &&
          !hostile(n) &&
          (n.units[p.id] > 0 ||
            (p.faction === 0 &&
              !p.used.tag &&
              total(n) === 0 &&
              MAP[n.id].links.some((i) => s.nodes[i].units[p.id]))),
      )
      .map((n) => n.id);
  if (tool === "recruit")
    return s.nodes.filter((n) => owned(n)).map((n) => n.id);
  if (tool === "build")
    return s.nodes.filter((n) => owned(n) && !n.structure).map((n) => n.id);
  if (tool === "spread")
    return s.nodes
      .filter(
        (n) => owned(n) && n.structure === "mural" && n.spreadRound !== s.round,
      )
      .map((n) => n.id);
  if (tool === "scan")
    return s.nodes
      .filter((n) => owned(n) && n.structure === "tower")
      .map((n) => n.id);
  return [];
}
function districtText(n) {
  const m = MAP[n.id];
  return `${m.name}. ${m.site ? "Broadcast Site. " : ""}${m.home >= 0 ? "Protected hideout. " : ""}Owner: ${name(n.owner)}. ${
    Object.entries(n.units)
      .map(([id, c]) => `${name(id)}: ${c} operatives`)
      .join(". ") || "No operatives"
  }. Structure: ${n.structure || "none"}. ${Object.entries(n.influence)
    .map(([id, c]) => `${name(id)} influence ${c} of 2`)
    .join(". ")}. Adjacent: ${m.links.map((i) => MAP[i].name).join(", ")}.`;
}
function cityMap() {
  const legal = s.status === "playing" && !s.battle ? legalNodes() : [],
    p = me();
  return `<section class="map-panel" aria-label="City map"><div class="map-heading"><h2>The city</h2><div class="row compact"><button id="fit-city" class="quiet" data-do="fit">Fit city</button><button id="review-operation" class="quiet mobile-operation-jump" data-do="review-operation">Review operation</button><button id="center-district" class="quiet" data-do="center">Center selection</button></div></div><p class="map-instruction">${tool === "move" ? (d.pick === "from" ? "Choose one of your groups as the origin." : "Choose a highlighted destination. A dashed route shows your plan.") : legal.length ? "Outlined districts can use your selected operation." : "Select a district to inspect it."}</p><p class="pan-hint">Scroll the map sideways to see all districts, or use Fit city. Use Review operation to return to your controls.</p><div class="map-viewport ${fitMap ? "fit" : ""}" tabindex="0" role="region" aria-label="Scrollable city map"><svg class="city-map" viewBox="80 45 780 660" role="group" aria-label="City districts"><g class="streets">${MAP.flatMap((n) => n.links.filter((i) => i > n.id).map((i) => `<path d="M${n.x} ${n.y}L${MAP[i].x} ${MAP[i].y}"/>`)).join("")}</g>${s.battle ? `<path class="planned-route battle-route" d="M${MAP[s.battle.from].x} ${MAP[s.battle.from].y}L${MAP[s.battle.to].x} ${MAP[s.battle.to].y}"/>` : ""}${!s.battle && s.status === "playing" && tool === "move" && d.to !== "" && route(d.from, d.to) ? `<path class="planned-route" d="M${MAP[d.from].x} ${MAP[d.from].y}${route(d.from, d.to).via !== null ? `L${MAP[route(d.from, d.to).via].x} ${MAP[route(d.from, d.to).via].y}` : ""}L${MAP[d.to].x} ${MAP[d.to].y}"/>` : ""}${MAP.map(
    (m) => {
      const n = s.nodes[m.id],
        f = faction(n.owner),
        color = f?.color || "#60777e",
        sel = m.id === selected,
        label =
          tool === "move" && Number(d.from) === m.id
            ? "Origin"
            : tool === "move" && d.to !== "" && Number(d.to) === m.id
              ? "Destination"
              : legal.includes(m.id)
                ? "Available"
                : "";
      return `<g id="district-${m.id}" class="map-node ${sel ? "selected" : ""} ${legal.includes(m.id) ? "legal" : ""} ${s.battle?.to === m.id ? "conflict" : ""}" data-node="${m.id}" tabindex="0" role="button" aria-pressed="${sel}" aria-label="${esc(districtText(n))}${label ? " " + label : ""}" transform="translate(${m.x} ${m.y})"><title>${esc(districtText(n))}</title><circle class="target-ring" r="37"/><${m.home >= 0 ? "rect" : "circle"} class="disc" ${m.home >= 0 ? 'x="-27" y="-27" width="54" height="54" rx="4"' : 'r="28"'} style="--crew:${color}"/><path class="graffiti" d="M-22 15L22 6" stroke="${color}"/><text class="tag" y="3" fill="${f?.color || "#a9babf"}" text-anchor="middle">${f?.short || "·"}</text>${m.site ? '<g transform="translate(26 -25)"><circle r="11" fill="#142229"/><text class="site-symbol" y="6" text-anchor="middle">★</text></g>' : ""}${Object.entries(
        n.units,
      )
        .map(
          ([id, c]) =>
            `<g transform="translate(0 29)"><rect x="-16" y="-9" width="32" height="22" rx="3" fill="${faction(id)?.color}"/><text class="unit-count" y="7" text-anchor="middle">${c}</text></g>`,
        )
        .join(
          "",
        )}<text class="node-name" y="61" text-anchor="middle">${esc(m.name)}</text>${s.battle?.to === m.id ? `<text class="battle-map-label" y="-40" text-anchor="middle">${s.battle.count} attacking · ${esc(name(s.battle.attacker))}</text>` : ""}${n.structure ? `<text class="structure-symbol" x="37" y="4">${n.structure === "tower" ? "T" : "M"}</text>` : ""}${Object.entries(
        n.influence,
      )
        .map(
          ([id, c], i) =>
            `<text class="influence-label" x="-46" y="${-18 + i * 17}" fill="${faction(id)?.color}">${faction(id)?.short} ${c}/2</text>`,
        )
        .join(
          "",
        )}${label ? `<text class="node-hint" y="-44" text-anchor="middle">${label}</text>` : ""}</g>`;
    },
  ).join(
    "",
  )}</svg></div><div class="legend"><span>★ Broadcast Site</span><span>□ Hideout</span><span>Number = operatives</span>${details("map-key", "Map key", `<p>Two-letter tags identify a faction; colours match the crew list. A number shows that crew’s operatives. T = tower. M = mural. “1/2” = influence toward claiming a district. Select a district for the full description.</p>`)}${details("district-list", "District list", `<div class="district-list">${MAP.map((m) => `<button id="list-${m.id}" data-node="${m.id}">${esc(m.name)} · ${esc(name(s.nodes[m.id].owner))}</button>`).join("")}</div>`)}</div></section>`;
}
function request() {
  const a = { type: tool, node: selected };
  if (tool === "move") {
    const r = route(d.from, d.to);
    Object.assign(a, {
      from: d.from === "" ? -1 : Number(d.from),
      to: d.to === "" ? -1 : Number(d.to),
      count: Number(d.moveCount),
      via: r?.via ?? -1,
    });
  }
  if (tool === "recruit") a.count = Number(d.recruitCount);
  if (tool === "build") a.structure = d.structure;
  if (tool === "spread")
    a.targets = [
      d.target1 === "" ? -1 : Number(d.target1),
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
  if (pending)
    return "Retry the unconfirmed request before taking another operation.";
  if (s.status !== "playing") return "The match has ended.";
  if (s.battle) return "Waiting for the battle commitments.";
  if (s.players[s.turn].id !== p.id)
    return `Waiting for ${name(s.players[s.turn].id)}. You can use Diplomacy.`;
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
  return (
    3 +
    (s.event?.kind === "build" ? 1 : 0) -
    (me().faction === 2 && !me().used.build ? 1 : 0)
  );
}
function signalReason() {
  const p = me();
  if (blocked()) return "Wait for the connection or pending request.";
  if (s.status !== "playing") return "This match is complete.";
  if (p.signal)
    return "Announced. Hold your sites until the end of this round.";
  if (!p.actions) return "Announce before taking your final action.";
  if (p.ally) {
    const a = person(p.ally);
    if (p.barredRound === s.round || a.barredRound === s.round)
      return "Betrayal prevents a shared victory this round.";
    if (!a.actions)
      return "Both partners must have an action left to announce.";
  }
  return "";
}
function normalizeMove() {
  const ids = s.nodes.filter((n) => n.units[me().id] > 0).map((n) => n.id);
  if (!ids.includes(Number(d.from))) d.from = ids[0] ?? "";
  if (!route(d.from, d.to)) d.to = "";
  const max = s.nodes[d.from]?.units[me().id] || 1;
  d.moveCount = Math.max(1, Math.min(max, Number(d.moveCount) || 1));
}
const TITLES = {
  move: "Move operatives",
  tag: "Tag district",
  gather: "Gather resources",
  recruit: "Recruit operatives",
  build: "Build structure",
  spread: "Spread influence",
  explore: "Draw Operation card",
  scan: "Scan a crew",
  pass: "Pass your action",
};
function toolButton(t) {
  return `<button id="tool-${t}" data-tool="${t}" data-tip="${esc(HELP[t])}" class="${tool === t ? "selected" : ""}" aria-pressed="${tool === t}">${{ move: "Move", tag: "Tag", gather: "Gather", recruit: "Recruit", build: "Build", spread: "Spread", explore: "Explore", scan: "Scan", pass: "Pass" }[t]}</button>`;
}
function operationCost() {
  if (tool === "recruit")
    return `1 action · ${Number(d.recruitCount) || 0} Supply`;
  if (tool === "build") return `1 action · ${buildCost()} Supply`;
  if (["tag", "spread"].includes(tool)) return "1 action · 1 Supply";
  if (["explore", "scan"].includes(tool)) return "1 action · 1 Intel";
  if (tool === "gather")
    return `1 action · gain 2 Supply + ${s.event.kind === "gather" ? 2 : 1} Intel`;
  return "1 action · no resource cost";
}
function actionForm() {
  const p = me(),
    n = s.nodes[selected],
    m = MAP[selected];
  let form = "";
  if (tool === "move") {
    normalizeMove();
    const ids = MAP.filter((m) => route(d.from, m.id)).map((m) => m.id);
    form = `<div class="row"><button id="pick-from" class="quiet ${d.pick === "from" ? "selected" : ""}" data-pick="from">Choose origin</button><button id="pick-to" class="quiet ${d.pick === "to" ? "selected" : ""}" data-pick="to">Choose destination</button></div>${select(
      "from",
      "Origin",
      nodeOptions(
        d.from,
        s.nodes.filter((n) => n.units[p.id] > 0).map((n) => n.id),
        "Your operatives",
      ),
    )}${select("to", "Destination", opt("", "Choose a legal destination", d.to) + ids.map((id) => opt(id, MAP[id].name + (hostile(s.nodes[id]) ? " · starts combat" : route(d.from, id).via !== null ? " · Courier crossing" : ""), d.to)).join(""))}${number("moveCount", "Operatives", 1, s.nodes[d.from]?.units[p.id] || 1)}${d.to !== "" && route(d.from, d.to)?.via !== null ? `<p class="note">Courier route crosses ${MAP[route(d.from, d.to).via].name}. Uses your once-per-round ability.</p>` : ""}${d.to !== "" && hostile(s.nodes[d.to]) ? '<p class="warning">This move starts combat. Both crews will commit Supply in secret.</p>' : ""}`;
  }
  if (tool === "recruit")
    form = number("recruitCount", "Operatives to recruit", 1, 3);
  if (tool === "build")
    form = select(
      "structure",
      "Structure",
      opt("tower", "Surveillance tower", d.structure) +
        opt("mural", "Propaganda mural", d.structure),
      d.structure,
    );
  if (tool === "spread") {
    const ids = MAP[selected].links.filter(
      (i) => taggable(s.nodes[i]) && total(s.nodes[i]) === 0,
    );
    form = select("target1", "Influence target", nodeOptions(d.target1, ids));
    if (p.faction === 4 && !p.used.choir)
      form += select(
        "target2",
        "Optional second target",
        nodeOptions(d.target2, ids, "No second target"),
      );
  }
  if (tool === "scan") {
    const targets = s.players.filter(
      (x) =>
        x.id !== p.id &&
        x.id !== p.ally &&
        s.nodes.some(
          (t) =>
            t.units[x.id] > 0 &&
            distance(MAP[n.id], MAP[t.id]) <= (p.faction === 1 ? 2 : 1),
        ),
    );
    form = select(
      "target",
      "Crew in range",
      opt("", "Choose a crew", d.target) +
        targets.map((x) => opt(x.id, x.name, d.target)).join(""),
    );
  }
  const reason = validity(request()),
    advanced = [
      "recruit",
      "build",
      "spread",
      "explore",
      "scan",
      "pass",
    ].includes(tool);
  return `<section class="panel action-panel"><div class="panel-heading"><h2>${s.players[s.turn].id === p.id ? "Your operation" : "Plan your next operation"}</h2>${tip("actions", "Turn actions")}</div><div class="district-info"><h3>${esc(m.name)}</h3><p>${m.site ? "★ Broadcast Site" : m.home >= 0 ? "Protected hideout" : "Street district"} · ${esc(name(n.owner))}</p><p class="muted">${
    Object.entries(n.units)
      .map(([id, c]) => `${esc(name(id))}: ${c} operatives`)
      .join(" · ") || "No operatives"
  } · ${n.structure || "No structure"}</p>${
    Object.entries(n.influence).length
      ? `<p>${Object.entries(n.influence)
          .map(([id, c]) => `${esc(name(id))}: ${c}/2 influence`)
          .join(" · ")} ${tip("influence", "Influence")}</p>`
      : ""
  }</div><div class="tool-grid">${["move", "tag", "gather"].map(toolButton).join("")}</div>${details("more-actions", "More operations", `<div class="tool-grid">${["recruit", "build", "spread", "explore", "scan", "pass"].map(toolButton).join("")}</div>`, advanced)}<div class="panel-heading action-title"><h3>${TITLES[tool]}</h3>${tip(tool, TITLES[tool])}</div><p id="operation-cost" class="cost">${operationCost()}</p>${form}<p class="action-help">${esc(HELP[tool])}</p><button id="execute" class="primary wide" data-do="execute" ${reason ? "disabled" : ""}>${TITLES[tool]}</button><p id="why" class="why" aria-live="polite">${esc(reason || "Ready. This uses one action.")}</p><div class="signal-control"><div class="panel-heading"><h3>Signal Attempt</h3>${tip("signal", "Signal Attempt")}</div><button id="announce-signal" class="wide" data-do="signal" ${signalReason() ? "disabled" : ""}>${p.signal ? "Attempt announced" : "Announce an attempt"}</button><p class="muted">${esc(signalReason() || "Free. Warn the city before your last action.")}</p></div></section>`;
}
function battleReason() {
  if (blocked()) return "Wait for your connection or pending request.";
  if (
    d.supply === "" ||
    !Number.isInteger(Number(d.supply)) ||
    Number(d.supply) < 0 ||
    Number(d.supply) > Math.min(3, me().supply)
  )
    return `Choose a whole number from 0 to ${Math.min(3, me().supply)} Supply.`;
  if (d.cardId && !s.me.hand.some((c) => c.id === d.cardId))
    return "Choose a card currently in your hand.";
  return "";
}
function battleMath() {
  const b = s.battle,
    p = me(),
    role = p.id === b.attacker ? "attacker" : "defender",
    units = role === "attacker" ? b.count : s.nodes[b.to].units[p.id],
    card = s.me.hand.find((c) => c.id === d.cardId),
    supply = Number(d.supply) || 0,
    bonus =
      card?.kind === "falseflag"
        ? supply === 0
          ? 3
          : 0
        : CARDS[card?.kind]?.bonus || 0;
  return { role, units, supply, bonus, card, strength: units + supply + bonus };
}
function battle() {
  const b = s.battle,
    p = me(),
    fighter = [b.attacker, b.defender].includes(p.id),
    locked = b.locked.includes(p.id);
  let form = "";
  if (fighter && !locked) {
    const math = battleMath(),
      reason = battleReason();
    form = `<p>You are the <b>${math.role}</b>. Strength = operatives + Supply + card bonus.</p>${number("supply", "Secret Supply commitment", 0, Math.min(3, p.supply))}${select("cardId", "Operation card", opt("", "No card", d.cardId) + s.me.hand.map((c) => opt(c.id, CARDS[c.kind].name, d.cardId)).join(""), "cards")}<p id="combat-card-help" class="note">${math.card ? esc(CARDS[math.card.kind].text) : "No card selected. You can keep your cards for later."}</p><p id="combat-strength" class="strength-preview">Your planned strength: <b>${math.units} + ${math.supply} + ${math.bonus} = ${math.strength}</b></p><p class="muted">Counterfrequency can cancel a card bonus. Your opponent’s commitment is unknown. The defender wins ties.</p><button id="lock-commitment" class="primary wide" data-do="commit" ${reason ? "disabled" : ""}>Lock private commitment</button><p id="commit-why" class="why">${esc(reason || "Final once locked. Supply is spent even if you lose.")}</p>`;
  }
  return `<section class="panel battle-box"><div class="panel-heading"><h2>Combat</h2>${tip("commitment", "Combat commitments")}</div><h3>${MAP[b.to].name}</h3>${[b.attacker, b.defender].map((pid) => `<div class="battle-crew"><span><b>${esc(name(pid))}</b><br>${pid === b.attacker ? "Attacker" : "Defender"} · ${pid === b.attacker ? b.count : s.nodes[b.to].units[pid]} operatives</span><span>${b.locked.includes(pid) ? "Locked" : "Choosing"}</span></div>`).join("")}${fighter ? (locked ? `<p class="locked">Your lock: ${b.own.supply} Supply${b.own.card ? ` + ${CARDS[b.own.card.kind].name}` : "; no card"}. Waiting for your opponent.</p>` : form) : '<p class="note">Both combatants must lock. Their choices stay private until then.</p>'}<p class="muted">Loser retreats and loses one operative unless a card prevents it. A winning attacker must use Tag later to claim ownership.</p>${[b.attacker, b.defender].some((id) => !person(id).online && !person(id).bot) ? '<p class="warning">A fighter is disconnected. They can restore their crew; after 60 seconds the host can temporarily assign a bot in Host controls.</p>' : ""}</section>`;
}
function cards() {
  return `<section class="panel reference-panel">${details("cards", `Your Operation cards (${s.me.hand.length}/3)`, `${tip("cards", "Private Operation cards")}<div class="cards">${s.me.hand.map((c) => `<div class="op-card"><h3>${CARDS[c.kind].name}</h3><p>${CARDS[c.kind].text}</p></div>`).join("") || "<p>No cards. Explore to draw one.</p>"}</div>`)}${s.me.reports.length ? details("reports", `Private scan reports (${s.me.reports.length})`, s.me.reports.map((r) => `<p><b>${esc(r.target)}</b>: ${r.count} cards at scan · ${r.card ? CARDS[r.card].name : "Empty hand"}<br><span class="muted">Historical observation; the hand may have changed.</span></p>`).join("")) : ""}${details("my-faction", "Your faction ability", `<h3>${F[me().faction].name}</h3><p>${F[me().faction].ability}</p><p class="muted">${me().faction === 1 ? "Always active." : me().used[{ 0: "tag", 2: "build", 3: "courier", 4: "choir", 5: "ledger" }[me().faction]] ? "Used this round." : "Available this round."}</p>`)}</section>`;
}
function roster() {
  return details(
    "crew-list",
    "Crew standings",
    `<div class="crew-list">${s.players
      .map((p, i) => {
        const ns = s.nodes.filter((n) => n.owner === p.id),
          f = F[p.faction];
        return `<div class="crew ${i === s.turn && s.status === "playing" ? "active" : ""}" style="--crew:${f.color}"><h3>${esc(p.name)}${p.id === s.me.id ? " · you" : ""} <span class="muted">${p.bot ? (p.botTakeover ? "Temporary bot" : "Bot") : p.online ? "Human" : "Disconnected"}</span></h3><p>${f.name} · ${ns.filter((n) => MAP[n.id].site).length} sites · ${p.actions} actions left</p><p class="muted">${p.supply} Supply · ${p.intel} Intel · ${p.handCount === null ? "Hand private" : p.handCount + " cards"}</p>${p.ally ? `<p>Allied with ${esc(name(p.ally))}</p>` : ""}${p.signal ? "<p>Signal Attempt announced</p>" : ""}${p.barredRound === s.round ? "<p>Cannot share a victory this round</p>" : ""}${details("ability-" + p.id, "Faction ability", `<p>${f.ability}</p>`)}</div>`;
      })
      .join("")}</div>`,
  );
}
function tutorial() {
  if (
    !s.tutorialEnabled ||
    s.round !== 1 ||
    guideDismissed ||
    s.status !== "playing"
  )
    return "";
  const p = me(),
    home = MAP.find(
      (n) => n.home === s.players.findIndex((x) => x.id === p.id),
    );
  const pages = [
    [
      "Hold the signal",
      "Stars mark Broadcast Sites. Own three to win alone, or four with an ally. Occupying a district is not the same as owning it.",
    ],
    [
      "Meet your crew",
      `Your protected hideout is ${home.name}. ${F[p.faction].name}: ${F[p.faction].ability}`,
    ],
    [
      "Try your first operation",
      "Plan a Move to a highlighted neighbour, or Gather resources. Review the cost and confirm the operation yourself. The guide advances only after the server accepts an action.",
    ],
    [
      "Turn occupation into ownership",
      tagTargets().length
        ? "You can claim a highlighted district with Tag. It costs one Supply and a separate action. Underprint can also tag an adjacent empty district once per round."
        : "Move your operatives into a district first, then use Tag on a later turn. Tag costs one Supply and claims ownership; combat clears enemy operatives first.",
    ],
    [
      "Plan the rest of the round",
      "Each crew takes three actions, one at a time. Announce a free Signal Attempt before your final action if you plan to win. Combat and diplomacy have their own help buttons.",
    ],
  ];
  const [title, text] = s.battle
    ? [
        "Combat interrupts the lesson",
        "Resolve the combat panel first. Your lesson will resume at the same step afterward.",
      ]
    : pages[guideStep];
  return `<section class="tutorial" aria-label="First-round guide"><div class="panel-heading"><span class="muted">First-round guide · ${guideStep + 1} of 5</span><button id="skip-guide" class="quiet" data-do="skip-guide">Skip guide</button></div><h2>${title}</h2><p>${esc(text)}</p><div class="row compact">${guideStep > 0 ? '<button id="guide-back" class="quiet" data-do="guide-back">Back</button>' : ""}${!s.battle ? (guideStep === 1 ? '<button id="guide-home" data-do="guide-home">Show my hideout</button>' : guideStep === 2 ? '<button id="guide-move" data-do="guide-move">Plan a move</button><button id="guide-gather" data-do="guide-gather">Plan Gather</button>' : guideStep === 3 ? `<button id="guide-tag" data-do="guide-tag">${tagTargets().length ? "Plan Tag" : "Plan a move first"}</button>` : "") : ""}${guideStep !== 2 && !s.battle ? `<button id="guide-next" data-do="guide-next">${guideStep === 4 ? "Finish guide" : "Continue"}</button>` : ""}</div></section>`;
}
function hostControls() {
  if (!s.isHost || s.status !== "playing") return "";
  const active = s.players[s.turn],
    offline = s.players.filter((p) => !p.online && !p.bot),
    now = Date.now() + clockOffset;
  const recover = offline
    .map((p) => {
      const seconds = Math.max(
        0,
        60 - Math.floor((now - (s.offlineSince?.[p.id] || now)) / 1000),
      );
      return `<div class="recovery-row"><p id="recovery-message-${p.id}">${esc(p.name)}: ${seconds ? `bot takeover available in ${seconds}s` : "bot takeover available"}</p><button id="takeover-${p.id}" data-takeover="${p.id}" ${seconds || blocked() ? "disabled" : ""}>Assign temporary bot</button></div>`;
    })
    .join("");
  const skipReason = s.battle
    ? "Resolve combat, or use a temporary bot for a disconnected fighter."
    : active?.online || active?.bot
      ? "The active crew is available."
      : now - (s.offlineSince?.[active?.id] || now) < 60000
        ? "The active crew must be disconnected for 60 seconds."
        : "";
  return details(
    "host-controls",
    "Host controls",
    `${recover || "<p>All human crews are connected.</p>"}<p class="muted">A returning player restores control with their existing token. Their locked commitment stays unchanged.</p><button id="host-skip" data-do="skip" ${skipReason || blocked() || s.status !== "playing" ? "disabled" : ""}>Pass disconnected turn</button><p class="muted" id="skip-reason">${esc(skipReason)}</p><button id="host-reset" class="danger wide" data-do="reset">Return to lobby</button>`,
  );
}
function ending() {
  const winners = s.result.winners,
    won = winners.some((g) => g.ids.includes(s.me.id)),
    standings = [...s.result.standings].sort((a, b) => b.score - a.score);
  return `<section class="ending"><p class="eyebrow">Match complete · ${esc(s.result.reason)}</p><h1>${won ? "You hold the city." : "The final transmission."}</h1>${winners.length > 1 ? `<p>${winners.length} contenders share victory.</p>` : ""}<p><b>${esc(winners.map((g) => g.names).join(" / ") || "No crew secured the city")}</b>${s.result.reason === "Hold the Signal" ? " won by announcing and holding the required Broadcast Sites." : " finished with the highest eligible score."}</p><div class="table-scroll"><table><caption>Final standings</caption><thead><tr><th scope="col">Crew</th><th scope="col">Sites</th><th scope="col">Other districts</th><th scope="col">Alliance penalty</th><th scope="col">Score</th></tr></thead><tbody>${standings.map((g) => `<tr class="${winners.some((w) => w.ids.join() === g.ids.join()) ? "winner" : ""}"><th scope="row">${esc(g.names)}${!g.eligible ? " · shared victory barred" : ""}</th><td>${g.sites}</td><td>${g.districts - g.sites}</td><td>${g.ids.length === 2 ? "−3" : "—"}</td><td>${g.score}</td></tr>`).join("")}</tbody></table></div><p class="muted">Each site scores 2; other districts score 1. A formal pair combines territory and subtracts 3. Tied top eligible contenders share a score victory.</p>${s.isHost ? '<button id="ending-reset" class="primary" data-do="reset">Return to lobby</button>' : "<p>The host can return everyone to the lobby.</p>"}</section>`;
}
function game() {
  const p = me(),
    active = s.players[s.turn],
    ended = s.status === "finished",
    ns = s.nodes.filter((n) => n.owner === p.id),
    incoming = s.offers.filter((o) => o.to === p.id);
  return `<main id="main">${ended ? ending() : `<section class="turn-bar"><div><p class="eyebrow">Round ${s.round} of 8</p><h1>${s.battle ? "Resolve combat" : active.id === p.id ? "Your turn" : `${esc(active.name)}’s turn${active.bot ? " · Bot" : ""}`}</h1><p class="muted">${s.battle ? "Both fighters lock privately." : active.id === p.id ? `${p.actions} actions left. Choose an operation.` : "Plan while you wait, or open Diplomacy."} <span id="clock"></span></p></div><div class="resources"><div><b>${p.supply}</b><span>Supply ${tip("supply", "Supply")}</span></div><div><b>${p.intel}</b><span>Intel ${tip("intel", "Intel")}</span></div><div><b>${p.ally ? s.nodes.filter((n) => MAP[n.id].site && (n.owner === p.id || n.owner === p.ally)).length : ns.filter((n) => MAP[n.id].site).length}/${p.ally ? 4 : 3}</b><span>${p.ally ? "Alliance sites" : "Your sites"} ${tip("sites", "Broadcast Sites")}</span></div></div></section><p class="city-event"><b>${esc(s.event.name)}:</b> ${esc(s.event.text)}</p>`}${tutorial()}${incoming.length && !ended ? `<div class="offer-banner"><span>${incoming.length} incoming diplomacy offer${incoming.length > 1 ? "s" : ""}. Expires at the next operation.</span><button id="review-offers" data-do="diplomacy">Review offers</button></div>` : ""}<div class="game-layout"><section class="map-column">${cityMap()}<section class="panel reference-panel">${roster()}${details(
    "city-log",
    "Recent city activity",
    `<div class="log-scroll">${s.log
      .slice()
      .reverse()
      .map(
        (e) =>
          `<p class="log-entry"><span class="muted">Round ${e.round}</span> ${esc(e.text)}</p>`,
      )
      .join("")}</div>`,
  )}${hostControls()}</section></section><aside class="operations-column">${ended ? `<section class="panel"><h2>${esc(MAP[selected].name)}</h2><p>${esc(districtText(s.nodes[selected]))}</p><p class="muted">Final board. No further operations can be taken.</p></section>` : s.battle ? battle() : actionForm()}${cards()}</aside></div></main>`;
}
function diplomacyBase() {
  if (blocked()) return "Wait for the connection or pending request.";
  if (s.status !== "playing") return "The match has ended.";
  if (s.battle) return "Diplomacy resumes when combat ends.";
  return "";
}
function pactReason(from, to) {
  if (!from || !to) return "Choose another crew.";
  if (from.id === to.id) return "Choose another crew.";
  if (from.ally || to.ally) return "Both crews must be unallied.";
  if (
    s.nodes.some(
      (n) =>
        (n.units[from.id] > 0 && n.owner === to.id) ||
        (n.units[to.id] > 0 && n.owner === from.id),
    )
  )
    return "Move operatives out of each other’s territory before signing.";
  return "";
}
function tradeReason(o) {
  const from = person(o.from),
    to = person(o.to);
  if (!from || !to || from.id === to.id) return "Choose another crew.";
  for (const k of ["giveSupply", "giveIntel", "wantSupply", "wantIntel"])
    if (!Number.isInteger(o[k]) || o[k] < 0 || o[k] > 30)
      return "Trade quantities must be whole numbers from 0 to 30.";
  if (
    from.supply < o.giveSupply ||
    from.intel < o.giveIntel ||
    to.supply < o.wantSupply ||
    to.intel < o.wantIntel
  )
    return "A crew does not have the requested resources.";
  if (
    from.supply - o.giveSupply + o.wantSupply > 30 ||
    from.intel - o.giveIntel + o.wantIntel > 30 ||
    to.supply - o.wantSupply + o.giveSupply > 30 ||
    to.intel - o.wantIntel + o.giveIntel > 30
  )
    return "This trade would exceed the resource cap of 30.";
  return "";
}
function offerDraft() {
  return {
    from: s.me.id,
    to: d.dipTarget,
    kind: d.kind,
    giveSupply: Number(d.giveSupply),
    giveIntel: Number(d.giveIntel),
    wantSupply: Number(d.wantSupply),
    wantIntel: Number(d.wantIntel),
  };
}
function offerReason(o = offerDraft()) {
  return (
    diplomacyBase() ||
    (o.kind === "pact"
      ? pactReason(person(o.from), person(o.to))
      : tradeReason(o))
  );
}
function tradePreview(o) {
  const from = person(o.from),
    to = person(o.to);
  if (!from || !to) return "";
  const outgoing = o.from === s.me.id,
    p = me(),
    payS = outgoing ? o.giveSupply : o.wantSupply,
    payI = outgoing ? o.giveIntel : o.wantIntel,
    getS = outgoing ? o.wantSupply : o.giveSupply,
    getI = outgoing ? o.wantIntel : o.giveIntel;
  return `<p>You pay <b>${payS} Supply + ${payI} Intel</b>.<br>You receive <b>${getS} Supply + ${getI} Intel</b>.<br>Afterward: ${p.supply - payS + getS} Supply · ${p.intel - payI + getI} Intel.</p>`;
}
function diplomacy() {
  if (!s.me || s.status === "lobby") return;
  const p = me(),
    draft = offerDraft();
  $("dip-content").innerHTML =
    `<p class="muted">Offers expire when any crew takes an operation. ${tip("offers", "Offer expiration")}</p>${diplomacyBase() ? `<p class="warning">${esc(diplomacyBase())}</p>` : ""}${p.ally ? `<section class="pact-card"><h3>Allied with ${esc(name(p.ally))}</h3><p>Shared victory: four sites, with at least one each.</p><button id="break-pact" class="danger" data-do="break" ${diplomacyBase() || p.intel < 2 ? "disabled" : ""}>Betray alliance · 2 Intel</button><p class="muted">Your former partner receives 2 Supply. Both lose shared-victory eligibility this round; either may still win alone.${p.intel < 2 ? " You need 2 Intel to betray." : ""}</p></section>` : ""}<section><h3>Offers</h3>${
      s.offers
        .map((o) => {
          const reason = offerReason(o);
          return `<article class="offer"><h3>${esc(name(o.from))} → ${esc(name(o.to))}</h3>${o.kind === "pact" ? "<p>Alliance proposal: win together with four sites, at least one each. Signing clears both crews’ Signal announcements.</p>" : tradePreview(o)}<div class="row">${o.to === p.id ? `<button id="accept-${o.id}" class="primary" data-accept="${o.id}" ${reason ? "disabled" : ""}>Accept ${o.kind === "pact" ? "alliance" : "trade"}</button>` : ""}<button id="cancel-${o.id}" data-cancel="${o.id}" ${diplomacyBase() ? "disabled" : ""}>${o.to === p.id ? "Decline" : "Withdraw"}</button></div>${reason ? `<p class="why">${esc(reason)}</p>` : ""}</article>`;
        })
        .join("") || '<p class="muted">No open offers.</p>'
    }</section><section class="new-offer"><h3>Make an offer</h3>${select(
      "dipTarget",
      "Other crew",
      opt("", "Choose a crew", d.dipTarget) +
        s.players
          .filter((x) => x.id !== p.id)
          .map((x) => opt(x.id, x.name + (x.bot ? " · Bot" : ""), d.dipTarget))
          .join(""),
    )}${select("kind", "Offer type", opt("pact", "Alliance", d.kind) + opt("trade", "Resource trade", d.kind), d.kind === "pact" ? "pact" : "trade")}${d.kind === "trade" ? `<div class="trade-grid"><div><h3>You give</h3>${number("giveSupply", "Supply to give", 0, 30)}${number("giveIntel", "Intel to give", 0, 30)}</div><div><h3>You receive</h3>${number("wantSupply", "Supply to receive", 0, 30)}${number("wantIntel", "Intel to receive", 0, 30)}</div></div><div id="trade-preview" class="note">${tradePreview(draft) || "Choose a crew to preview this trade."}</div>` : '<p class="note">An alliance needs both crews’ consent. Shared victory needs four sites, at least one each. Signing clears earlier Signal announcements.</p>'}</section>`;
  $("dip-footer").innerHTML =
    `<button id="send-offer" class="primary wide" data-do="offer" ${offerReason(draft) ? "disabled" : ""}>Send ${d.kind === "pact" ? "alliance" : "trade"} offer</button><p id="offer-why" class="why">${esc(offerReason(draft) || "Ready. The other crew must accept.")}</p>`;
}
function focusKey(el) {
  if (!el) return null;
  if (el.id) return "#" + (globalThis.CSS?.escape ? CSS.escape(el.id) : el.id);
  for (const k of ["do", "tool", "pick", "help", "close"])
    if (el.dataset?.[k]) return `[data-${k}="${el.dataset[k]}"]`;
  return null;
}
function render() {
  const active = document.activeElement,
    key = focusKey(active),
    start = active?.selectionStart,
    end = active?.selectionEnd;
  const values = {};
  for (const id of ["callsign", "restore-token", "host-code"])
    if ($(id)) values[id] = $(id).value;
  const opened = {};
  document
    .querySelectorAll("details[data-persist]")
    .forEach((el) => (opened[el.dataset.persist] = el.open));
  const scrolls = {};
  for (const sel of [
    ".map-viewport",
    ".log-scroll",
    "#diplomacy",
    "#dip-content",
    "#rules",
    "#seat",
  ]) {
    const el = document.querySelector(sel);
    if (el) scrolls[sel] = [el.scrollLeft, el.scrollTop];
  }
  hideTooltip();
  $("app").innerHTML =
    header() + (s.me && s.status !== "lobby" ? game() : lobby());
  if ($("diplomacy").open) diplomacy();
  for (const [id, value] of Object.entries(values))
    if ($(id)) $(id).value = value;
  document.querySelectorAll("details[data-persist]").forEach((el) => {
    if (Object.hasOwn(opened, el.dataset.persist))
      el.open = opened[el.dataset.persist];
  });
  if (!s.me && (s.status !== "lobby" || s.players.length === 6 || joinError)) {
    const restore = document.querySelector('[data-persist="restore"]');
    if (restore) restore.open = true;
  }
  if (key) {
    const el = document.querySelector(key);
    if (el && !el.disabled) {
      try {
        el.focus({ preventScroll: true });
        if (typeof el.setSelectionRange === "function" && start !== null)
          el.setSelectionRange(start, end);
      } catch {}
    }
  }
  for (const [sel, [x, y]] of Object.entries(scrolls)) {
    const el = document.querySelector(sel);
    if (el) {
      el.scrollLeft = x;
      el.scrollTop = y;
    }
  }
  updateClock();
}
function updateClock() {
  updateRecovery();
  const el = $("clock");
  if (!el || !s.endsAt) return;
  const left = s.endsAt - (Date.now() + clockOffset);
  el.textContent =
    left <= 0
      ? "Time limit reached; finish this round."
      : `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")} remaining`;
}
setInterval(updateClock, 1000);
function updateRecovery() {
  if (!s.me || !s.isHost || s.status !== "playing") return;
  const now = Date.now() + clockOffset;
  for (const p of s.players.filter((p) => !p.online && !p.bot)) {
    const seconds = Math.max(
        0,
        60 - Math.floor((now - (s.offlineSince?.[p.id] || now)) / 1000),
      ),
      button = $("takeover-" + p.id),
      label = $("recovery-message-" + p.id);
    if (button) button.disabled = !!seconds || blocked();
    if (label)
      label.textContent = `${p.name}: ${seconds ? "bot takeover available in " + seconds + "s" : "bot takeover available"}`;
  }
  const active = s.players[s.turn],
    reason = s.battle
      ? "Resolve combat, or assign a bot to a disconnected fighter."
      : active.online || active.bot
        ? "The active crew is available."
        : now - (s.offlineSince?.[active.id] || now) < 60000
          ? "The active crew must be disconnected for 60 seconds."
          : "";
  if ($("host-skip")) $("host-skip").disabled = !!reason || blocked();
  if ($("skip-reason")) $("skip-reason").textContent = reason;
}
function refreshDerived() {
  if ($("execute")) {
    const reason = validity(request());
    $("execute").disabled = !!reason;
    $("why").textContent = reason || "Ready. This uses one action.";
    $("operation-cost").textContent = operationCost();
  }
  if ($("lock-commitment")) {
    const reason = battleReason(),
      m = battleMath();
    $("lock-commitment").disabled = !!reason;
    $("commit-why").textContent =
      reason || "Final once locked. Supply is spent even if you lose.";
    $("combat-strength").innerHTML =
      `Your planned strength: <b>${m.units} + ${m.supply} + ${m.bonus} = ${m.strength}</b>`;
  }
  if ($("send-offer")) {
    const reason = offerReason();
    $("send-offer").disabled = !!reason;
    $("offer-why").textContent = reason || "Ready. The other crew must accept.";
    if ($("trade-preview"))
      $("trade-preview").innerHTML =
        tradePreview(offerDraft()) || "Choose a crew to preview this trade.";
  }
}
function chooseTool(t) {
  tool = t;
  if (t === "move") {
    if (s.nodes[selected].units[me().id]) d.from = selected;
    normalizeMove();
    d.pick = "to";
  }
  if (t === "recruit")
    d.recruitCount = Math.min(3, Math.max(1, Number(d.recruitCount) || 1));
  if (t === "spread") {
    d.target1 = "";
    d.target2 = "";
  }
  render();
}
function selectNode(id) {
  selected = id;
  if (tool === "move") {
    if (d.pick === "from") {
      if (s.nodes[id].units[me().id] > 0) {
        d.from = id;
        d.to = "";
        d.pick = "to";
      } else
        notice(
          "Choose a group containing your operatives as the origin.",
          true,
        );
    } else if (route(d.from, id)) {
      d.to = id;
    } else
      notice(
        "That district is not a legal destination from this origin.",
        true,
      );
  }
  render();
}
function centerSelection() {
  const svg = $("district-" + selected);
  if (svg)
    svg.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "instant",
    });
}
function tagTargets() {
  const previous = tool;
  tool = "tag";
  const ids = legalNodes();
  tool = previous;
  return ids;
}
function guidePlan(t) {
  if (t === "move") {
    tool = "move";
    d.from = s.nodes.find((n) => n.units[me().id] > 0)?.id ?? selected;
    normalizeMove();
    d.pick = "to";
    const candidate = MAP.filter((m) => route(d.from, m.id)).sort(
      (a, b) =>
        Number(hostile(s.nodes[a.id])) - Number(hostile(s.nodes[b.id])) ||
        Number(b.site) - Number(a.site),
    )[0];
    d.to = candidate?.id ?? "";
    selected = Number(d.from);
    d.moveCount = 1;
  } else if (t === "tag") {
    const ids = tagTargets();
    if (!ids.length) {
      guidePlan("move");
      notice("Move into a district first, then Tag it on a later turn.");
      return;
    }
    selected = ids.sort((a, b) => Number(MAP[b].site) - Number(MAP[a].site))[0];
    tool = "tag";
  } else tool = t;
  render();
  $("execute")?.scrollIntoView({ block: "nearest" });
}
async function copyText(text, status) {
  try {
    if (navigator.clipboard && window.isSecureContext)
      await navigator.clipboard.writeText(text);
    else {
      const input = document.createElement("textarea");
      input.value = text;
      input.className = "copy-buffer";
      document.body.appendChild(input);
      input.select();
      if (!document.execCommand("copy")) throw Error("copy unavailable");
      input.remove();
    }
    if (status) $(status).textContent = "Copied.";
    notice("Copied to clipboard.");
  } catch {
    if (status)
      $(status).textContent = "Select the token and copy it manually.";
    notice("Select the text and use Ctrl+C to copy.", true);
  }
}
function manual() {
  const sections = RULES.split("\n\n");
  $("rules-content").innerHTML =
    `<div class="quick-rules"><h3>The basics</h3><ol><li>Move operatives, then Tag to claim a district.</li><li>Take one operation at a time; three per crew each round.</li><li>Own three starred sites alone, or four as an alliance.</li><li>Announce a Signal Attempt before your last action.</li></ol></div><label for="rule-search">Find a rule</label><input id="rule-search" type="search" placeholder="Try combat, mural, or winning"><nav class="rule-nav" aria-label="Rule sections">${sections
      .map(
        (b, i) =>
          `<button id="rule-nav-${i}" class="quiet" data-rule="${i}">${esc(
            b
              .split("\n")[0]
              .toLowerCase()
              .replace(/^./, (x) => x.toUpperCase()),
          )}</button>`,
      )
      .join("")}</nav>${sections
      .map((b, i) => {
        const lines = b.split("\n"),
          title = lines
            .shift()
            .toLowerCase()
            .replace(/^./, (x) => x.toUpperCase());
        return `<details class="manual-section" id="rule-section-${i}" ${i === 0 ? "open" : ""}><summary>${esc(title)}</summary>${lines
          .flatMap((line) =>
            line.length > 400 ? line.split(/(?<=[.!?])\s+(?=[A-Z])/) : [line],
          )
          .map(
            (line) =>
              `<p>${esc(line).replace(/^([^:]{1,20}):/, "<b>$1:</b>")}</p>`,
          )
          .join("")}</details>`;
      })
      .join(
        "",
      )}<section class="manual-section"><h3>Faction cards</h3>${F.map((f) => `<p><b>${f.name}:</b> ${f.ability}</p>`).join("")}<h3>Operation cards</h3>${Object.values(
      CARDS,
    )
      .map((c) => `<p><b>${c.name}:</b> ${c.text}</p>`)
      .join("")}</section>`;
}
let tipTarget = null,
  tipPinned = false,
  tipCloseTimer = null;
function hideTooltip() {
  clearTimeout(tipCloseTimer);
  if (tipTarget) {
    tipTarget.removeAttribute("aria-describedby");
    tipTarget.setAttribute("aria-expanded", "false");
  }
  const el = $("guide-tip");
  if (el) {
    el.hidden = true;
    el.classList.remove("inline-tip");
    document.body.appendChild(el);
  }
  tipTarget = null;
  tipPinned = false;
}
function showTooltip(target, pinned = false) {
  const text = target.dataset.tip || HELP[target.dataset.help];
  if (!text) return;
  hideTooltip();
  tipTarget = target;
  tipPinned = pinned;
  const el = $("guide-tip");
  const inline =
    target.closest(".battle-box") && target.dataset.help === "commitment";
  if (inline) {
    target.closest(".panel-heading").after(el);
    el.classList.add("inline-tip");
  } else (target.closest("dialog") || document.body).appendChild(el);
  el.textContent = text;
  el.hidden = false;
  target.setAttribute("aria-describedby", "guide-tip");
  if (target.dataset.help) target.setAttribute("aria-expanded", "true");
  if (inline) {
    el.removeAttribute("style");
    return;
  }
  const r = target.getBoundingClientRect(),
    w = Math.min(320, innerWidth - 24);
  el.style.width = w + "px";
  el.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + "px";
  const h = el.getBoundingClientRect().height;
  el.style.top =
    (r.bottom + h + 12 > innerHeight
      ? Math.max(12, r.top - h - 8)
      : r.bottom + 8) + "px";
}
document.addEventListener("pointerover", (e) => {
  if (e.target.closest("#guide-tip")) {
    clearTimeout(tipCloseTimer);
    return;
  }
  const target = e.target.closest("[data-help],[data-tip]");
  if (target && !tipPinned) {
    clearTimeout(tipCloseTimer);
    showTooltip(target);
  }
});
document.addEventListener("pointerout", (e) => {
  if (tipPinned) return;
  if (e.target.closest("[data-help],[data-tip],#guide-tip")) {
    const next = e.relatedTarget;
    if (
      next instanceof Element &&
      (next.closest("#guide-tip") ||
        next.closest("[data-help],[data-tip]") === tipTarget)
    )
      return;
    clearTimeout(tipCloseTimer);
    tipCloseTimer = setTimeout(hideTooltip, 180);
  }
});
document.addEventListener("focusin", (e) => {
  const target = e.target.closest("[data-help],[data-tip]");
  if (target) showTooltip(target);
});
document.addEventListener("focusout", () => {
  if (!tipPinned) hideTooltip();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && tipTarget) {
    hideTooltip();
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const n = e.target.closest("[data-node]");
  if (n && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    selectNode(Number(n.dataset.node));
  }
});
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
document.addEventListener("click", (e) => {
  const help = e.target.closest("[data-help]");
  if (help) {
    if (tipTarget === help && tipPinned) hideTooltip();
    else showTooltip(help, true);
    return;
  }
  if (tipPinned && !e.target.closest("#guide-tip")) hideTooltip();
  const b = e.target.closest("button,[data-node]");
  if (!b || b.disabled) return;
  if (b.dataset.close) {
    $(b.dataset.close).close();
    return;
  }
  if (b.dataset.rule !== undefined) {
    const el = $("rule-section-" + b.dataset.rule);
    el.hidden = false;
    el.open = true;
    el.scrollIntoView({ block: "start" });
    return;
  }
  if (b.dataset.node !== undefined) {
    selectNode(Number(b.dataset.node));
    return;
  }
  if (b.dataset.tool) {
    chooseTool(b.dataset.tool);
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
  if (b.dataset.takeover) {
    send({ type: "takeover", target: b.dataset.takeover });
    return;
  }
  if (b.dataset.copy) {
    copyText(b.dataset.copy);
    return;
  }
  switch (b.dataset.do) {
    case "review-operation": {
      const panel = document.querySelector(
        ".action-panel,.battle-box,.operations-column .panel",
      );
      panel?.scrollIntoView({ block: "start" });
      const heading = panel?.querySelector("h2");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
      break;
    }
    case "rules":
      $("rules").showModal();
      break;
    case "seat":
      $("seat-token").value = token;
      $("copy-status").textContent = "";
      $("seat").showModal();
      break;
    case "copy-token":
      copyText(token, "copy-status");
      break;
    case "forget":
      if (
        confirm(
          "Clear the saved token on this browser? This does not free the crew’s seat. Save the token first if you need to return.",
        )
      ) {
        token = "";
        try {
          localStorage.removeItem("cold-static-seat");
        } catch {}
        location.reload();
      }
      break;
    case "retry":
      transmit();
      break;
    case "diplomacy":
      diplomacy();
      $("diplomacy").showModal();
      break;
    case "execute":
      if (!validity(request())) send(request());
      break;
    case "signal":
      send({ type: "signal" });
      break;
    case "addBot":
    case "fillBots":
    case "start":
      send({ type: b.dataset.do });
      break;
    case "commit":
      if (!battleReason())
        send({
          type: "commit",
          battleId: s.battle.id,
          supply: Number(d.supply),
          cardId: d.cardId || null,
        });
      break;
    case "offer": {
      const o = offerDraft();
      if (!offerReason(o))
        send({
          type: "offer",
          target: o.to,
          kind: o.kind,
          giveSupply: o.giveSupply,
          giveIntel: o.giveIntel,
          wantSupply: o.wantSupply,
          wantIntel: o.wantIntel,
        });
      break;
    }
    case "break":
      if (
        confirm(
          "Betray this alliance? Pay 2 Intel; your former partner receives 2 Supply. Both lose shared-victory eligibility this round. Either may still win alone.",
        )
      )
        send({ type: "break" });
      break;
    case "reset":
      if (
        confirm("Replace this saved match and return all crews to the lobby?")
      )
        send({ type: "reset" });
      break;
    case "skip":
      send({ type: "skip" });
      break;
    case "guide":
      guideDismissed = false;
      storeGuide();
      render();
      break;
    case "skip-guide":
      guideDismissed = true;
      storeGuide();
      render();
      break;
    case "guide-back":
      guideStep = Math.max(0, guideStep - 1);
      storeGuide();
      render();
      break;
    case "guide-next":
      if (guideStep === 4) guideDismissed = true;
      else guideStep++;
      storeGuide();
      render();
      break;
    case "guide-home":
      selected = MAP.find(
        (n) => n.home === s.players.findIndex((p) => p.id === s.me.id),
      ).id;
      render();
      centerSelection();
      break;
    case "guide-move":
      guidePlan("move");
      break;
    case "guide-gather":
      guidePlan("gather");
      break;
    case "guide-tag":
      guidePlan("tag");
      break;
    case "fit": {
      fitMap = true;
      const el = document.querySelector(".map-viewport");
      el.classList.add("fit");
      el.scrollLeft = 0;
      break;
    }
    case "center":
      centerSelection();
      break;
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.hostDuration !== undefined) {
    send({ type: "duration", minutes: Number(el.value) });
    return;
  }
  if (el.dataset.tutorial !== undefined) {
    send({ type: "tutorial", enabled: el.checked });
    return;
  }
  const key = el.dataset.field;
  if (!key) return;
  if (key === "faction") {
    send({ type: "faction", faction: Number(el.value) });
    return;
  }
  d[key] = el.value;
  if (key === "from") {
    d.to = "";
    d.pick = "to";
    normalizeMove();
  }
  if (key === "to" && d.to !== "") selected = Number(d.to);
  if (el.type !== "number") render();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "rule-search") {
    const q = e.target.value.trim().toLowerCase();
    $("rules-content")
      .querySelectorAll("details.manual-section")
      .forEach((el) => {
        el.hidden = !!q && !el.textContent.toLowerCase().includes(q);
        if (q && !el.hidden) el.open = true;
      });
    return;
  }
  const key = e.target.dataset.field;
  if (!key) return;
  d[key] = e.target.value;
  refreshDerived();
});
manual();
render();
