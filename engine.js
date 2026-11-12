"use strict";
const crypto = require("node:crypto");
const { FACTIONS, CARDS, EVENTS, MAP } = require("./public/shared");
const clone = (x) => structuredClone(x),
  fail = (m) => {
    throw new Error(m);
  };
const need = (v, m) => {
  if (!v) fail(m);
};
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const random = (n) => crypto.randomInt(n);
const distance = (a, b) =>
  Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs(a.q + a.r - b.q - b.r),
  );
function initial() {
  return {
    schema: 1,
    version: 0,
    status: "lobby",
    players: [],
    nodes: [],
    log: [],
    round: 0,
    turn: 0,
    starter: 0,
    battle: null,
    offers: [],
    duration: 210,
    tutorialEnabled: false,
    receipts: {},
  };
}
function log(s, text) {
  s.log.push({ round: s.round, text });
  s.log = s.log.slice(-150);
}
function add(p, k, n) {
  p[k] = Math.min(30, p[k] + n);
}
function draw(p) {
  if (p.hand.length < 3) {
    const keys = Object.keys(CARDS);
    p.hand.push({ id: crypto.randomUUID(), kind: keys[random(keys.length)] });
  }
}
function mine(s, p) {
  return s.nodes.filter((n) => n.owner === p.id);
}
function units(n) {
  return Object.values(n.units).reduce((a, b) => a + b, 0);
}
function enemyPresent(n, id) {
  return Object.entries(n.units).some(([p, num]) => p !== id && num > 0);
}
function available(s, n, p) {
  return n.owner === p.id && !enemyPresent(n, p.id);
}
function player(s, id) {
  const p = s.players.find((p) => p.id === id);
  need(p, "Unknown player.");
  return p;
}
function node(s, id) {
  need(int(id, 0, 18), "Choose a district.");
  return s.nodes[id];
}
function spend(p, resource, n) {
  need(
    p[resource] >= n,
    `Need ${n} ${resource === "supply" ? "Supply" : "Intel"}.`,
  );
  p[resource] -= n;
}
function hostileOwner(s, p, n) {
  return n.owner !== p.id && n.owner !== p.ally;
}
function targetTag(s, p, n) {
  need(MAP[n.id].home < 0, "Hideouts cannot change hands.");
  need(n.owner !== p.id, "You already control this district.");
  need(
    !p.ally || n.owner !== p.ally,
    "Break your pact before taking allied territory.",
  );
}
function rangeFor(p) {
  return p.faction === 1 ? 2 : 1;
}
function canWatch(s, p, other) {
  return s.nodes.some(
    (n) =>
      n.structure === "tower" &&
      available(s, n, p) &&
      s.nodes.some(
        (t) =>
          (t.units[other.id] || 0) > 0 &&
          distance(MAP[n.id], MAP[t.id]) <= rangeFor(p),
      ),
  );
}
function startRound(s) {
  s.round++;
  s.turn = s.starter;
  s.offers = [];
  for (const p of s.players) {
    p.actions = 3;
    p.signal = false;
    p.used = {};
    p.reports = [];
    const ns = mine(s, p);
    add(
      p,
      "supply",
      3 +
        Math.floor(ns.filter((n) => MAP[n.id].home < 0).length / 2) +
        ns.filter((n) => n.structure === "mural" && available(s, n, p)).length,
    );
    add(p, "intel", 2);
  }
  for (const n of s.nodes) n.spreadRound = 0;
  const choices = EVENTS.filter((e) => e.name !== "Final transmission");
  s.event = s.round === 8 ? EVENTS[7] : choices[random(choices.length)];
  for (const p of s.players) {
    if (s.event.kind === "supply") add(p, "supply", 2);
    if (s.event.kind === "intel") add(p, "intel", 1);
    if (s.event.kind === "cards") draw(p);
    if (s.event.kind === "market") {
      add(p, "supply", 1);
      add(p, "intel", 1);
    }
  }
  log(s, `Round ${s.round}: ${s.event.name}. ${s.event.text}`);
}
function start(s, now) {
  need(s.status === "lobby", "Match already started.");
  need(s.players.length === 6, "Six players must join before starting.");
  need(
    new Set(s.players.map((p) => p.faction)).size === 6,
    "Each crew needs a different faction.",
  );
  s.status = "playing";
  s.round = 0;
  s.starter = 0;
  s.battle = null;
  s.offers = [];
  s.log = [];
  s.startedAt = now;
  s.endsAt = now + s.duration * 60000;
  s.nodes = MAP.map((n) => ({
    id: n.id,
    owner: n.home < 0 ? null : s.players[n.home].id,
    units: n.home < 0 ? {} : { [s.players[n.home].id]: 4 },
    structure: null,
    influence: {},
    explored: n.home >= 0,
    spreadRound: 0,
  }));
  for (const p of s.players) {
    Object.assign(p, {
      supply: 3,
      intel: 1,
      hand: [],
      reports: [],
      ally: null,
      barredRound: 0,
      used: {},
    });
    draw(p);
    draw(p);
  }
  log(s, "The occupation signal goes dark. Six crews take to the streets.");
  startRound(s);
}
function contenders(s) {
  const groups = [],
    seen = new Set();
  for (const p of s.players) {
    if (seen.has(p.id)) continue;
    const ps = [p];
    if (p.ally) ps.push(player(s, p.ally));
    ps.forEach((x) => seen.add(x.id));
    const ns = s.nodes.filter((n) => ps.some((p) => p.id === n.owner));
    groups.push({
      ids: ps.map((p) => p.id),
      names: ps.map((p) => p.name).join(" + "),
      sites: ns.filter((n) => MAP[n.id].site).length,
      districts: ns.length,
      score:
        ns.reduce((a, n) => a + (MAP[n.id].site ? 2 : 1), 0) -
        (ps.length === 2 ? 3 : 0),
      eligible: ps.length === 1 || ps.every((p) => p.barredRound !== s.round),
      signal: ps.some((p) => p.signal),
      eachSite: ps.every((p) =>
        ns.some((n) => n.owner === p.id && MAP[n.id].site),
      ),
    });
  }
  return groups;
}
function endRound(s, now) {
  const groups = contenders(s),
    qual = groups
      .filter(
        (g) =>
          g.eligible &&
          g.signal &&
          g.sites >= (g.ids.length === 2 ? 4 : 3) &&
          g.eachSite,
      )
      .sort((a, b) => b.sites - a.sites || b.districts - a.districts);
  if (
    qual.length &&
    (!qual[1] ||
      qual[0].sites !== qual[1].sites ||
      qual[0].districts !== qual[1].districts)
  ) {
    s.status = "finished";
    s.result = {
      reason: "Hold the Signal",
      winners: [qual[0]],
      standings: groups,
    };
  } else if (s.round === 8 || now >= s.endsAt) {
    const ranked = groups
      .filter((g) => g.eligible)
      .sort((a, b) => b.score - a.score);
    s.status = "finished";
    s.result = {
      reason: ranked.length
        ? s.round === 8
          ? "Eight-round score"
          : "Time-limit score"
        : "City deadlock",
      winners: ranked.filter((g) => g.score === ranked[0].score),
      standings: groups,
    };
  }
  if (s.status === "finished") {
    log(
      s,
      `Final transmission: ${s.result.winners.map((g) => g.names).join(" / ") || "no crew"} — ${s.result.reason}.`,
    );
    return;
  }
  s.starter = (s.starter + 1) % 6;
  startRound(s);
}
function nextTurn(s, now) {
  if (s.players.every((p) => p.actions === 0)) {
    endRound(s, now);
    return;
  }
  do {
    s.turn = (s.turn + 1) % 6;
  } while (!s.players[s.turn].actions);
}
function claim(s, p, n) {
  n.owner = p.id;
  n.influence = {};
  log(s, `${p.name} tags ${MAP[n.id].name}.`);
}
function exploreCache(s, p, n) {
  if (n.explored) return;
  n.explored = true;
  const v = random(3);
  if (v === 0) add(p, "supply", 2);
  else if (v === 1) add(p, "intel", 1);
  else draw(p);
  log(
    s,
    `${p.name} uncovers a ${["Supply cache (+2)", "dead drop (+1 Intel)", "sealed dossier"][v]} at ${MAP[n.id].name}.`,
  );
}
function retreat(s, p, from, count, preferred) {
  if (count <= 0) return;
  const candidates = mine(s, p)
    .filter((n) => n.id !== from && !enemyPresent(n, p.id))
    .sort(
      (a, b) =>
        distance(MAP[a.id], MAP[from]) - distance(MAP[b.id], MAP[from]) ||
        a.id - b.id,
    );
  const dest =
    preferred !== undefined && !enemyPresent(s.nodes[preferred], p.id)
      ? s.nodes[preferred]
      : candidates[0];
  need(dest, "No retreat destination.");
  dest.units[p.id] = (dest.units[p.id] || 0) + count;
  log(
    s,
    `${p.name} retreats ${count} operative${count === 1 ? "" : "s"} to ${MAP[dest.id].name}.`,
  );
}
function combatBonus(c) {
  return !c.card
    ? 0
    : c.card.kind === "falseflag"
      ? c.supply === 0
        ? 3
        : 0
      : CARDS[c.card.kind].bonus;
}
function resolveBattle(s, now) {
  const b = s.battle,
    ap = player(s, b.attacker),
    dp = player(s, b.defender),
    ac = b.commitments[ap.id],
    dc = b.commitments[dp.id],
    n = s.nodes[b.to];
  let ab = combatBonus(ac),
    db = combatBonus(dc);
  if (dc.card?.kind === "intercept") ab = 0;
  if (ac.card?.kind === "intercept") db = 0;
  const as = b.count + ac.supply + ab,
    ds = (n.units[dp.id] || 0) + dc.supply + db,
    aw = as > ds;
  for (const [p, c] of [
    [ap, ac],
    [dp, dc],
  ]) {
    spend(p, "supply", c.supply);
    if (c.card) p.hand = p.hand.filter((x) => x.id !== c.card.id);
    let refund = c.card?.kind === "feint" ? Math.min(2, c.supply) : 0;
    if (p.faction === 5 && !p.used.ledger && c.supply > refund) {
      refund++;
      p.used.ledger = true;
    }
    add(p, "supply", refund);
  }
  log(
    s,
    `${ap.name} reveals ${ac.supply} Supply${ac.card ? ` + ${CARDS[ac.card.kind].name}` : ""}; ${dp.name} reveals ${dc.supply} Supply${dc.card ? ` + ${CARDS[dc.card.kind].name}` : ""}. Strength ${as}–${ds}: ${aw ? ap.name : dp.name} wins${as === ds ? " (defender holds the tie)" : ""}.`,
  );
  if (aw) {
    const survivors = Math.max(
      0,
      n.units[dp.id] - (dc.card?.kind === "evac" ? 0 : 1),
    );
    delete n.units[dp.id];
    retreat(s, dp, b.to, survivors);
    n.units[ap.id] = b.count;
    exploreCache(s, ap, n);
  } else {
    retreat(
      s,
      ap,
      b.to,
      Math.max(0, b.count - (ac.card?.kind === "evac" ? 0 : 1)),
      b.from,
    );
  }
  s.battle = null;
  nextTurn(s, now);
}
function operation(s, p, a, now) {
  need(!s.battle, "Resolve the battle first.");
  need(s.players[s.turn].id === p.id, "Wait for your turn.");
  need(p.actions > 0, "No actions remaining.");
  switch (a.type) {
    case "recruit": {
      const n = node(s, a.node);
      need(
        available(s, n, p),
        "Recruit at a district you control with no hostile operatives.",
      );
      need(int(a.count, 1, 3), "Recruit 1–3 operatives.");
      need(
        s.nodes.reduce((sum, n) => sum + (n.units[p.id] || 0), 0) + a.count <=
          12,
        "Maximum 12 deployed operatives.",
      );
      spend(p, "supply", a.count);
      n.units[p.id] = (n.units[p.id] || 0) + a.count;
      log(s, `${p.name} recruits ${a.count} at ${MAP[n.id].name}.`);
      break;
    }
    case "move": {
      const from = node(s, a.from),
        to = node(s, a.to);
      need(from !== to, "Choose a different destination.");
      need(
        int(a.count, 1, 12) && (from.units[p.id] || 0) >= a.count,
        "Choose operatives at your origin.",
      );
      need(
        MAP[to.id].home < 0 || to.owner === p.id,
        "Other crews’ hideouts cannot be entered.",
      );
      if (!MAP[from.id].links.includes(to.id)) {
        need(
          p.faction === 3 && !p.used.courier,
          "Destination must be adjacent.",
        );
        const via = node(s, a.via);
        need(
          MAP[from.id].links.includes(via.id) &&
            MAP[via.id].links.includes(to.id) &&
            MAP[via.id].home < 0 &&
            hostileOwner(s, p, via),
          "Courier route must cross one hostile non-hideout district.",
        );
        p.used.courier = true;
      }
      need(
        !p.ally || !(to.units[p.ally] > 0),
        "Allies cannot share an occupied district.",
      );
      from.units[p.id] -= a.count;
      if (!from.units[p.id]) delete from.units[p.id];
      const defender = Object.keys(to.units).find(
        (id) => to.units[id] > 0 && id !== p.id,
      );
      log(
        s,
        `${p.name} moves ${a.count} from ${MAP[from.id].name} to ${MAP[to.id].name}.`,
      );
      if (defender) {
        need(defender !== p.ally, "Break your pact before attacking.");
        s.battle = {
          id: crypto.randomUUID(),
          from: from.id,
          to: to.id,
          count: a.count,
          attacker: p.id,
          defender,
          commitments: {},
        };
        log(
          s,
          "Combat opened. Both sides must lock their private commitments.",
        );
      } else {
        to.units[p.id] = (to.units[p.id] || 0) + a.count;
        exploreCache(s, p, to);
      }
      break;
    }
    case "tag": {
      const n = node(s, a.node);
      targetTag(s, p, n);
      need(!enemyPresent(n, p.id), "Clear hostile operatives before tagging.");
      if (!(n.units[p.id] > 0)) {
        need(
          p.faction === 0 &&
            !p.used.tag &&
            units(n) === 0 &&
            MAP[n.id].links.some((i) => s.nodes[i].units[p.id] > 0),
          "Tag where you have operatives, or use Underprint on an adjacent empty district.",
        );
        p.used.tag = true;
      }
      spend(p, "supply", 1);
      claim(s, p, n);
      break;
    }
    case "build": {
      const n = node(s, a.node);
      need(
        available(s, n, p),
        "Build at a district you control with no hostile operatives.",
      );
      need(!n.structure, "Only one structure per district.");
      need(
        ["tower", "mural"].includes(a.structure),
        "Choose a tower or mural.",
      );
      const discount = p.faction === 2 && !p.used.build ? 1 : 0;
      spend(p, "supply", 3 + (s.event.kind === "build" ? 1 : 0) - discount);
      p.used.build = true;
      n.structure = a.structure;
      log(s, `${p.name} builds a ${a.structure} at ${MAP[n.id].name}.`);
      break;
    }
    case "spread": {
      const n = node(s, a.node);
      need(
        available(s, n, p) && n.structure === "mural",
        "Select your unoccupied-by-enemies mural.",
      );
      need(n.spreadRound !== s.round, "This mural already spread this round.");
      need(
        Array.isArray(a.targets) &&
          a.targets.length >= 1 &&
          a.targets.length <= 2 &&
          new Set(a.targets).size === a.targets.length,
        "Choose one or two different targets.",
      );
      if (a.targets.length === 2)
        need(
          p.faction === 4 && !p.used.choir,
          "Only Choir can spread to two targets once per round.",
        );
      for (const id of a.targets) {
        const t = node(s, id);
        targetTag(s, p, t);
        need(
          MAP[n.id].links.includes(id) && units(t) === 0,
          "Influence targets must be adjacent and empty.",
        );
      }
      spend(p, "supply", 1);
      n.spreadRound = s.round;
      if (a.targets.length === 2) p.used.choir = true;
      for (const id of a.targets) {
        const t = node(s, id);
        t.influence[p.id] = (t.influence[p.id] || 0) + 1;
        log(
          s,
          `${p.name} spreads influence to ${MAP[id].name} (${t.influence[p.id]}/2).`,
        );
        if (t.influence[p.id] >= 2) claim(s, p, t);
      }
      break;
    }
    case "gather":
      add(p, "supply", 2);
      add(p, "intel", s.event.kind === "gather" ? 2 : 1);
      log(s, `${p.name} gathers supplies and intelligence.`);
      break;
    case "explore":
      need(p.hand.length < 3, "Your hand is full (3 cards).");
      spend(p, "intel", 1);
      draw(p);
      log(s, `${p.name} collects a sealed Operation dossier.`);
      break;
    case "scan": {
      const n = node(s, a.node),
        op = player(s, a.target);
      need(
        available(s, n, p) && n.structure === "tower",
        "Select your operational surveillance tower.",
      );
      need(op.id !== p.id && op.id !== p.ally, "Choose an enemy crew.");
      need(
        s.nodes.some(
          (t) =>
            t.units[op.id] > 0 && distance(MAP[n.id], MAP[t.id]) <= rangeFor(p),
        ),
        "Target has no operatives in this tower’s range.",
      );
      spend(p, "intel", 1);
      const c = op.hand.length ? op.hand[random(op.hand.length)] : null;
      p.reports.push({
        round: s.round,
        target: op.name,
        count: op.hand.length,
        card: c?.kind || null,
      });
      log(
        s,
        `${p.name} intercepts a private transmission through ${MAP[n.id].name}.`,
      );
      break;
    }
    case "pass":
      log(s, `${p.name} passes.`);
      break;
    default:
      fail("Unknown operation.");
  }
  p.actions--;
  s.offers = [];
  if (!s.battle) nextTurn(s, now);
}
function apply(original, id, a, now = Date.now()) {
  const s = clone(original),
    p = player(s, id);
  need(s.status === "playing", "Match is not in progress.");
  need(a && typeof a === "object", "Invalid action.");
  if (a.type === "commit") {
    const b = s.battle;
    need(b && a.battleId === b.id, "This battle is no longer active.");
    need(
      [b.attacker, b.defender].includes(p.id),
      "Only combatants can commit.",
    );
    need(!b.commitments[p.id], "Your commitment is already locked.");
    need(int(a.supply, 0, 3), "Commit 0–3 Supply.");
    need(p.supply >= a.supply, "Not enough Supply.");
    const c = a.cardId ? p.hand.find((c) => c.id === a.cardId) : null;
    need(!a.cardId || c, "Card is not in your hand.");
    b.commitments[p.id] = { supply: a.supply, card: c };
    if (b.commitments[b.attacker] && b.commitments[b.defender])
      resolveBattle(s, now);
  } else if (a.type === "signal") {
    need(p.actions > 0, "Announce before taking your third action.");
    if (p.ally) {
      need(
        p.barredRound !== s.round,
        "Betrayal bars your shared victory this round.",
      );
      const ally = player(s, p.ally);
      need(
        ally.actions > 0,
        "Announce a shared attempt while both partners have actions left.",
      );
      need(ally.barredRound !== s.round, "Your partner is barred this round.");
    }
    need(!p.signal, "Already announced.");
    p.signal = true;
    log(s, `${p.name} announces a Signal Attempt!`);
  } else if (["offer", "accept", "break", "cancel"].includes(a.type)) {
    need(!s.battle, "Diplomacy pauses until combat resolves.");
    if (a.type === "break") {
      need(p.ally, "You have no pact.");
      const other = player(s, p.ally);
      spend(p, "intel", 2);
      add(other, "supply", 2);
      p.ally = null;
      other.ally = null;
      p.barredRound = s.round;
      other.barredRound = s.round;
      p.signal = false;
      other.signal = false;
      s.offers = [];
      log(
        s,
        `${p.name} betrays ${other.name}. Both lose shared-victory eligibility this round; ${other.name} receives 2 Supply.`,
      );
    } else if (a.type === "offer") {
      const to = player(s, a.target);
      need(to.id !== p.id, "Choose another crew.");
      need(["pact", "trade"].includes(a.kind), "Choose pact or trade.");
      if (a.kind === "pact") {
        need(!p.ally && !to.ally, "Both crews must be unallied.");
        need(
          !s.nodes.some(
            (n) =>
              ((n.units[p.id] || 0) > 0 && n.owner === to.id) ||
              ((n.units[to.id] || 0) > 0 && n.owner === p.id),
          ),
          "Clear operatives out of each other’s territory before signing.",
        );
      }
      const terms = {};
      for (const key of [
        "giveSupply",
        "giveIntel",
        "wantSupply",
        "wantIntel",
      ]) {
        terms[key] = a[key] ?? 0;
        need(int(terms[key], 0, 30), "Trade quantities must be 0–30.");
      }
      need(
        s.offers.filter((o) => o.from === p.id).length < 5,
        "Cancel an outstanding offer first.",
      );
      s.offers.push({
        id: crypto.randomUUID(),
        from: p.id,
        to: to.id,
        kind: a.kind,
        ...terms,
      });
    } else if (a.type === "cancel") {
      const o = s.offers.find((o) => o.id === a.offerId);
      need(o && (o.from === p.id || o.to === p.id), "Offer not found.");
      s.offers = s.offers.filter((x) => x.id !== o.id);
    } else {
      const o = s.offers.find((o) => o.id === a.offerId);
      need(o && o.to === p.id, "Offer expired or addressed to someone else.");
      const from = player(s, o.from);
      if (o.kind === "pact") {
        need(!p.ally && !from.ally, "A crew is already allied.");
        need(
          !s.nodes.some(
            (n) =>
              ((n.units[p.id] || 0) > 0 && n.owner === from.id) ||
              ((n.units[from.id] || 0) > 0 && n.owner === p.id),
          ),
          "Clear each other’s territory before signing.",
        );
        p.ally = from.id;
        from.ally = p.id;
        p.signal = false;
        from.signal = false;
        log(
          s,
          `${from.name} and ${p.name} sign a pact. Both must reannounce any Signal Attempt.`,
        );
      } else {
        need(
          from.supply >= o.giveSupply &&
            from.intel >= o.giveIntel &&
            p.supply >= o.wantSupply &&
            p.intel >= o.wantIntel,
          "A trader no longer has the offered resources.",
        );
        need(
          from.supply - o.giveSupply + o.wantSupply <= 30 &&
            from.intel - o.giveIntel + o.wantIntel <= 30 &&
            p.supply - o.wantSupply + o.giveSupply <= 30 &&
            p.intel - o.wantIntel + o.giveIntel <= 30,
          "Trade would exceed the resource cap of 30.",
        );
        from.supply += o.wantSupply - o.giveSupply;
        from.intel += o.wantIntel - o.giveIntel;
        p.supply += o.giveSupply - o.wantSupply;
        p.intel += o.giveIntel - o.wantIntel;
        log(s, `${from.name} trades with ${p.name}.`);
      }
      s.offers = s.offers.filter((x) => x.id !== o.id);
    }
  } else operation(s, p, a, now);
  s.version++;
  return s;
}
function view(s, id, connected = []) {
  const me = s.players.find((p) => p.id === id),
    b = s.battle;
  return {
    version: s.version,
    status: s.status,
    round: s.round,
    turn: s.turn,
    starter: s.starter,
    duration: s.duration,
    tutorialEnabled: !!s.tutorialEnabled,
    tutorial: {
      enabled: !!s.tutorialEnabled,
      active: !!s.tutorialEnabled && s.status === "playing" && s.round === 1,
    },
    endsAt: s.endsAt,
    event: s.event,
    nodes: clone(s.nodes),
    log: clone(s.log),
    result: s.result,
    standings: s.status === "lobby" ? [] : contenders(s),
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      faction: p.faction,
      bot: !!p.bot,
      botTakeover: !!p.botTakeover,
      online: connected.includes(p.id),
      actions: p.actions,
      supply: p.supply,
      intel: p.intel,
      ally: p.ally,
      signal: p.signal,
      barredRound: p.barredRound,
      used: clone(p.used || {}),
      handCount:
        p.id === id || (me && s.status !== "lobby" && canWatch(s, me, p))
          ? p.hand?.length
          : null,
    })),
    me: me
      ? {
          id: me.id,
          hand: clone(me.hand || []),
          reports: clone(me.reports || []),
        }
      : null,
    offers: clone(s.offers.filter((o) => o.from === id || o.to === id)),
    battle: b
      ? {
          id: b.id,
          from: b.from,
          to: b.to,
          count: b.count,
          attacker: b.attacker,
          defender: b.defender,
          locked: Object.keys(b.commitments),
          own: b.commitments[id] ? clone(b.commitments[id]) : null,
        }
      : null,
  };
}
module.exports = {
  initial,
  apply,
  start,
  view,
  contenders,
  distance,
  canWatch,
};
