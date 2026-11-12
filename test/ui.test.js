"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const E = require("../engine");
function fixture() {
  const s = E.initial();
  s.players = Array.from({ length: 6 }, (_, i) => ({
    id: "p" + i,
    name: i === 0 ? "Alice <img src=x onerror=bad()>" : "Agent " + i,
    faction: i,
    token: "secret" + i,
  }));
  E.start(s, Date.now());
  // Starting city events are random; individual UI scenarios control their
  // resources explicitly rather than inheriting an unrelated event modifier.
  s.event = require("../public/shared").EVENTS[0];
  for (const p of s.players) {
    p.supply = 6;
    p.intel = 3;
  }
  return s;
}
function client({
  actionReply = (_, cb) => cb(null, { ok: true }),
  storage = {},
} = {}) {
  const html = fs.readFileSync(
    path.join(__dirname, "../public/index.html"),
    "utf8",
  );
  const dom = new JSDOM(html, {
    url: "http://localhost:3000",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const handlers = {},
    sent = [];
  // jsdom has no layout or native dialog implementation. Keep application
  // event/focus behavior real while replacing only those browser primitives.
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  for (const [key, value] of Object.entries(storage))
    dom.window.localStorage.setItem(key, value);
  const socket = {
    connected: true,
    on: (k, fn) => (handlers[k] = fn),
    timeout() {
      return this;
    },
    emit(type, data, cb) {
      sent.push({ type, data: structuredClone(data), reply: cb });
      if (type === "action") actionReply(data, cb);
    },
  };
  dom.window.io = () => socket;
  dom.window.confirm = () => true;
  dom.window.eval(
    fs.readFileSync(path.join(__dirname, "../public/shared.js"), "utf8"),
  );
  dom.window.eval(
    fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8"),
  );
  return {
    dom,
    w: dom.window,
    doc: dom.window.document,
    emit: (s) => handlers.state(s),
    socket,
    handlers,
    sent,
  };
}
function state(s, i = 0) {
  const v = E.view(
    s,
    "p" + i,
    s.players.map((p) => p.id),
  );
  v.isHost = i === 0;
  v.addresses = { lan: ["http://192.168.1.2:3000"] };
  return v;
}
test("lobby and game render, player text is escaped, 19 keyboard-accessible map controls", (t) => {
  const c = client();
  t.after(() => c.dom.window.close());
  assert.match(c.doc.body.textContent, /Join the game/);
  const s = fixture();
  c.emit(state(s));
  assert.equal(c.doc.querySelectorAll(".map-node").length, 19);
  assert.equal(c.doc.querySelectorAll('.map-node[tabindex="0"]').length, 19);
  assert.equal(c.doc.querySelector("img"), null);
  assert.match(c.doc.body.textContent, /Alice <img/);
  assert.equal(
    c.doc.querySelectorAll(".op-card").length,
    s.players[0].hand.length,
  );
  assert.equal(c.doc.querySelectorAll(".crew").length, 6);
});
test("map selection and legal action controls send a versioned request", (t) => {
  const c = client();
  t.after(() => c.dom.window.close());
  const s = fixture();
  c.emit(state(s));
  c.doc.querySelector('[data-tool="move"]').click();
  c.doc
    .querySelector('[data-node="1"]')
    .dispatchEvent(
      new c.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  const btn = c.doc.getElementById("execute");
  assert.equal(btn.disabled, false);
  btn.click();
  const req = c.sent.at(-1);
  assert.equal(req.type, "action");
  assert.equal(req.data.action.type, "move");
  assert.equal(req.data.action.from, 7);
  assert.equal(req.data.action.to, 1);
  assert.equal(req.data.version, s.version);
  assert.ok(req.data.id.length > 8);
});
test("unavailable actions show reasons; forms preserve edits across incoming state", (t) => {
  const c = client();
  t.after(() => c.dom.window.close());
  let s = fixture();
  c.emit(state(s, 1));
  assert.equal(c.doc.getElementById("execute").disabled, true);
  assert.match(c.doc.getElementById("why").textContent, /Waiting/);
  c.emit({ status: "lobby", version: 0, players: [], me: null });
  const input = c.doc.getElementById("callsign");
  input.value = "In progress";
  input.focus();
  c.emit({ status: "lobby", version: 1, players: [], me: null });
  assert.equal(c.doc.getElementById("callsign").value, "In progress");
});
test("private commitment form renders only for fighters and locked choice is shown only to owner", (t) => {
  const c = client();
  t.after(() => c.dom.window.close());
  let s = fixture();
  s.nodes[1].units.p0 = 2;
  s.nodes[0].units.p1 = 2;
  s = E.apply(s, "p0", { type: "move", from: 1, to: 0, count: 2 });
  c.emit(state(s, 2));
  assert.equal(c.doc.querySelector('[data-do="commit"]'), null);
  c.emit(state(s, 0));
  assert.ok(c.doc.querySelector('[data-do="commit"]'));
  s = E.apply(s, "p0", { type: "commit", battleId: s.battle.id, supply: 1 });
  c.emit(state(s, 0));
  assert.match(
    c.doc.querySelector(".locked").textContent,
    /Your lock: 1 Supply/,
  );
  assert.equal(c.doc.querySelector('[data-do="commit"]'), null);
});

function setup(t, options) {
  const c = client(options);
  t.after(() => c.dom.window.close());
  return c;
}
function edit(c, id, value, event = "input") {
  const el = c.doc.getElementById(id);
  assert.ok(el, `Expected editable control ${id}`);
  el.value = String(value);
  el.dispatchEvent(new c.w.Event(event, { bubbles: true }));
}
function click(c, id) {
  const el = c.doc.getElementById(id);
  assert.ok(el, `Expected button ${id}`);
  el.click();
}
function combatFixture() {
  let s = fixture();
  s.nodes[1].units.p0 = 2;
  s.nodes[0].units.p1 = 2;
  return E.apply(s, "p0", { type: "move", from: 1, to: 0, count: 2 });
}
function openTrade(c) {
  click(c, "open-diplomacy");
  edit(c, "dipTarget", "p1", "change");
  edit(c, "kind", "trade", "change");
}
function guideToOperation(c) {
  click(c, "guide-next");
  click(c, "guide-next");
  assert.match(
    c.doc.querySelector(".tutorial h2").textContent,
    /first operation/,
  );
}

test("tool activation and diplomacy rerenders preserve focus, edits and dialog scroll", (t) => {
  const c = setup(t);
  const s = fixture();
  c.emit(state(s));
  const recruit = c.doc.getElementById("tool-recruit");
  recruit.focus();
  recruit.click();
  assert.equal(c.doc.activeElement.id, "tool-recruit");
  c.emit(state(s));
  assert.equal(c.doc.activeElement.id, "tool-recruit");
  openTrade(c);
  edit(c, "giveSupply", 2);
  c.doc.getElementById("giveSupply").focus();
  c.doc.getElementById("diplomacy").scrollTop = 90;
  c.emit(state(s));
  assert.equal(c.doc.activeElement.id, "giveSupply");
  assert.equal(c.doc.getElementById("giveSupply").value, "2");
  assert.equal(c.doc.getElementById("diplomacy").scrollTop, 90);
});

test("recruit costs update while typing and recruit/move quantities remain independent", (t) => {
  const c = setup(t);
  c.emit(state(fixture()));
  click(c, "tool-recruit");
  edit(c, "recruitCount", 3);
  assert.match(c.doc.getElementById("operation-cost").textContent, /3 Supply/);
  assert.equal(c.doc.getElementById("execute").disabled, false);
  click(c, "tool-move");
  assert.equal(c.doc.getElementById("moveCount").value, "1");
  edit(c, "moveCount", 4);
  click(c, "tool-recruit");
  assert.equal(c.doc.getElementById("recruitCount").value, "3");
  assert.match(c.doc.getElementById("operation-cost").textContent, /3 Supply/);
  click(c, "execute");
  assert.equal(c.sent.at(-1).data.action.count, 3);
});

test("an unconfirmed action blocks new requests and retry preserves its identity and payload", (t) => {
  let attempts = 0;
  const c = setup(t, {
    actionReply: (_, reply) => {
      attempts++;
      if (attempts === 1) reply(new Error("ack timed out"));
      else reply(null, { ok: true, duplicate: true });
    },
  });
  const s = fixture();
  c.emit(state(s));
  click(c, "execute");
  const original = c.sent[0].data;
  assert.equal(c.doc.getElementById("execute").disabled, true);
  assert.match(c.doc.querySelector(".pending-banner").textContent, /gather/);
  click(c, "tool-move");
  c.doc.getElementById("announce-signal").click();
  assert.equal(c.sent.length, 1);
  c.emit(state(s));
  assert.equal(c.doc.getElementById("execute").disabled, true);
  click(c, "retry-request");
  assert.equal(c.sent.length, 2);
  assert.deepEqual(c.sent[1].data, original);
  assert.equal(c.doc.querySelector(".pending-banner"), null);
});

test("a full lobby offers restoration without presenting a join form", (t) => {
  const c = setup(t);
  const s = fixture();
  c.emit({ status: "lobby", version: 4, players: state(s).players, me: null });
  assert.equal(c.doc.getElementById("join-form"), null);
  assert.match(
    c.doc.querySelector(".setup-panel h2").textContent,
    /Restore your crew/,
  );
  assert.ok(c.doc.getElementById("restore-form"));
  assert.equal(c.doc.querySelector('[data-persist="restore"]').open, true);
  edit(c, "restore-token", " private-token ");
  c.doc
    .getElementById("restore-form")
    .dispatchEvent(
      new c.w.Event("submit", { bubbles: true, cancelable: true }),
    );
  assert.equal(c.sent.at(-1).type, "join");
  assert.equal(c.sent.at(-1).data.token, "private-token");
});

test("host setup exposes bot and optional tutorial controls and treats bots as available seats", (t) => {
  const c = setup(t);
  const s = fixture();
  s.status = "lobby";
  s.players = s.players.slice(0, 1);
  c.emit(state(s));
  assert.equal(c.doc.getElementById("start-game").disabled, true);
  click(c, "fill-bots");
  assert.equal(c.sent.at(-1).data.action.type, "fillBots");
  click(c, "add-bot");
  assert.equal(c.sent.at(-1).data.action.type, "addBot");
  const checkbox = c.doc.getElementById("tutorial-enabled");
  checkbox.checked = true;
  checkbox.dispatchEvent(new c.w.Event("change", { bubbles: true }));
  assert.equal(c.sent.at(-1).data.action.type, "tutorial");
  assert.equal(c.sent.at(-1).data.action.enabled, true);
  const full = fixture();
  full.status = "lobby";
  full.players.slice(1).forEach((p) => (p.bot = true));
  const v = state(full);
  v.players.slice(1).forEach((p) => (p.online = false));
  c.emit(v);
  assert.equal(c.doc.getElementById("start-game").disabled, false);
  assert.equal(c.doc.getElementById("add-bot").disabled, true);
  assert.match(c.doc.querySelectorAll(".seat-row")[1].textContent, /Bot/);
});

test("tutorial can be skipped and resumed, persists across reload, and disappears after round one", (t) => {
  const c = setup(t);
  const s = fixture();
  s.tutorialEnabled = true;
  c.emit(state(s));
  click(c, "guide-next");
  click(c, "skip-guide");
  assert.equal(c.doc.querySelector(".tutorial"), null);
  const storage = Object.fromEntries(
    Object.keys(c.w.localStorage).map((key) => [
      key,
      c.w.localStorage.getItem(key),
    ]),
  );
  const restored = setup(t, { storage });
  restored.emit(state(s));
  assert.equal(restored.doc.querySelector(".tutorial"), null);
  click(restored, "open-guide");
  assert.match(
    restored.doc.querySelector(".tutorial h2").textContent,
    /Meet your crew/,
  );
  s.round = 2;
  restored.emit(state(s));
  assert.equal(restored.doc.querySelector(".tutorial"), null);
  assert.equal(restored.doc.getElementById("open-guide"), null);
});

test("tutorial advances from practice only after an accepted operation changes the crew state", (t) => {
  let reject = true;
  const c = setup(t, {
    actionReply: (_, cb) =>
      cb(null, reject ? { ok: false, error: "City changed" } : { ok: true }),
  });
  let s = fixture();
  s.tutorialEnabled = true;
  c.emit(state(s));
  guideToOperation(c);
  click(c, "guide-gather");
  assert.equal(c.sent.length, 0, "planning must not take an action");
  click(c, "execute");
  c.emit(state(s));
  assert.match(
    c.doc.querySelector(".tutorial h2").textContent,
    /first operation/,
  );
  reject = false;
  click(c, "execute");
  assert.match(
    c.doc.querySelector(".tutorial h2").textContent,
    /first operation/,
  );
  s = E.apply(s, "p0", { type: "gather" });
  c.emit(state(s));
  assert.match(
    c.doc.querySelector(".tutorial h2").textContent,
    /occupation into ownership/,
  );
});

test("tutorial yields to another crew's battle and resumes its current step", (t) => {
  const c = setup(t);
  const s = fixture();
  s.tutorialEnabled = true;
  c.emit(state(s));
  guideToOperation(c);
  const interrupted = state(s);
  interrupted.battle = {
    id: "other-battle",
    attacker: "p1",
    defender: "p2",
    from: 2,
    to: 0,
    count: 2,
    locked: [],
    own: null,
  };
  interrupted.nodes[0].units.p2 = 2;
  c.emit(interrupted);
  assert.match(
    c.doc.querySelector(".tutorial h2").textContent,
    /Combat interrupts/,
  );
  assert.equal(c.doc.getElementById("guide-gather"), null);
  assert.equal(c.doc.getElementById("execute"), null);
  assert.equal(
    c.doc.getElementById("lock-commitment"),
    null,
    "a spectator cannot commit",
  );
  c.emit(state(s));
  assert.match(
    c.doc.querySelector(".tutorial h2").textContent,
    /first operation/,
  );
});

test("contextual help is keyboard reachable and dismisses with Escape, repeated click or outside click", (t) => {
  const c = setup(t);
  c.emit(state(fixture()));
  const help = c.doc.querySelector('[data-help="supply"]');
  const tooltip = c.doc.getElementById("guide-tip");
  help.focus();
  assert.equal(tooltip.hidden, false);
  assert.equal(help.getAttribute("aria-describedby"), "guide-tip");
  assert.match(tooltip.textContent, /Supply pays/);
  help.dispatchEvent(
    new c.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(tooltip.hidden, true);
  assert.equal(help.hasAttribute("aria-describedby"), false);
  help.click();
  assert.equal(tooltip.hidden, false);
  help.click();
  assert.equal(tooltip.hidden, true);
  help.click();
  c.doc.body.click();
  assert.equal(tooltip.hidden, true);
});

test("combat validates secret Supply and recomputes strength including conditional card bonuses", (t) => {
  const c = setup(t);
  const s = combatFixture();
  s.players[0].hand = [{ id: "false-card", kind: "falseflag" }];
  c.emit(state(s));
  assert.equal(c.doc.getElementById("execute"), null);
  edit(c, "cardId", "false-card", "change");
  assert.match(
    c.doc.getElementById("combat-strength").textContent,
    /2 \+ 0 \+ 3 = 5/,
  );
  for (const invalid of ["-1", "1.5", "4"]) {
    edit(c, "supply", invalid);
    assert.equal(
      c.doc.getElementById("lock-commitment").disabled,
      true,
      invalid,
    );
    assert.match(
      c.doc.getElementById("commit-why").textContent,
      /whole number/,
    );
  }
  edit(c, "supply", 2);
  assert.equal(c.doc.getElementById("lock-commitment").disabled, false);
  assert.match(
    c.doc.getElementById("combat-strength").textContent,
    /2 \+ 2 \+ 0 = 4/,
  );
  click(c, "lock-commitment");
  assert.equal(c.sent.at(-1).data.action.supply, 2);
  assert.equal(c.sent.at(-1).data.action.cardId, "false-card");
});

test("incoming offers are visible outside diplomacy and incoming trade terms use the recipient perspective", (t) => {
  const c = setup(t);
  const s = fixture();
  c.emit(state(s));
  s.offers = [
    {
      id: "offer-1",
      kind: "trade",
      from: "p1",
      to: "p0",
      giveSupply: 2,
      giveIntel: 0,
      wantSupply: 0,
      wantIntel: 1,
    },
  ];
  c.emit(state(s));
  assert.equal(c.doc.querySelector("#open-diplomacy .count").textContent, "1");
  assert.match(c.doc.querySelector(".offer-banner").textContent, /1 incoming/);
  assert.match(c.doc.getElementById("announcer").textContent, /offer received/);
  click(c, "review-offers");
  const offer = c.doc.querySelector(".offer");
  assert.match(offer.textContent, /You pay 0 Supply \+ 1 Intel/);
  assert.match(offer.textContent, /You receive 2 Supply \+ 0 Intel/);
  assert.match(offer.textContent, /Afterward: 8 Supply · 2 Intel/);
  assert.equal(c.doc.getElementById("accept-offer-1").disabled, false);
  s.players[0].intel = 0;
  c.emit(state(s));
  assert.equal(c.doc.getElementById("accept-offer-1").disabled, true);
  assert.match(c.doc.querySelector(".offer .why").textContent, /does not have/);
});

test("trade drafting previews final balances and blocks insufficient resources, fractions and caps", (t) => {
  const c = setup(t);
  const s = fixture();
  c.emit(state(s));
  openTrade(c);
  edit(c, "giveSupply", 2);
  edit(c, "wantIntel", 1);
  assert.match(
    c.doc.getElementById("trade-preview").textContent,
    /Afterward: 4 Supply · 4 Intel/,
  );
  assert.equal(c.doc.getElementById("send-offer").disabled, false);
  edit(c, "giveSupply", 7);
  assert.equal(c.doc.getElementById("send-offer").disabled, true);
  assert.match(c.doc.getElementById("offer-why").textContent, /does not have/);
  edit(c, "giveSupply", 1.5);
  assert.match(c.doc.getElementById("offer-why").textContent, /whole numbers/);
  edit(c, "giveSupply", 2);
  s.players[1].supply = 30;
  c.emit(state(s));
  assert.equal(c.doc.getElementById("send-offer").disabled, true);
  assert.match(c.doc.getElementById("offer-why").textContent, /cap of 30/);
  s.players[1].supply = 6;
  c.emit(state(s));
  click(c, "send-offer");
  assert.equal(c.sent.at(-1).data.action.type, "offer");
  assert.equal(c.sent.at(-1).data.action.giveSupply, 2);
  assert.equal(c.sent.at(-1).data.action.wantIntel, 1);
});

test("disclosures, map pan and log scroll survive remote state changes", (t) => {
  const c = setup(t);
  const s = fixture();
  c.emit(state(s));
  for (const key of [
    "crew-list",
    "city-log",
    "map-key",
    "district-list",
    "cards",
  ])
    c.doc.querySelector(`[data-persist="${key}"]`).open = true;
  c.doc.querySelector(".map-viewport").scrollLeft = 125;
  c.doc.querySelector(".log-scroll").scrollTop = 75;
  c.emit(state(s));
  for (const key of [
    "crew-list",
    "city-log",
    "map-key",
    "district-list",
    "cards",
  ])
    assert.equal(
      c.doc.querySelector(`[data-persist="${key}"]`).open,
      true,
      key,
    );
  assert.equal(c.doc.querySelector(".map-viewport").scrollLeft, 125);
  assert.equal(c.doc.querySelector(".log-scroll").scrollTop, 75);
});

test("finished games show ranked standings and reset without an operation form", (t) => {
  const c = setup(t);
  const s = fixture();
  s.status = "finished";
  const standings = E.contenders(s);
  standings[1].score = 9;
  s.result = { reason: "Time-limit score", winners: [standings[1]], standings };
  c.emit(state(s));
  assert.equal(c.doc.querySelector(".action-panel"), null);
  assert.equal(c.doc.getElementById("execute"), null);
  assert.equal(c.doc.getElementById("announce-signal"), null);
  assert.equal(
    c.doc.querySelector(".ending tbody tr th").textContent,
    "Agent 1",
  );
  assert.equal(c.doc.querySelectorAll(".ending tbody tr").length, 6);
  click(c, "ending-reset");
  assert.equal(c.sent.at(-1).data.action.type, "reset");
});
