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
  return s;
}
function client() {
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
  const socket = {
    connected: true,
    on: (k, fn) => (handlers[k] = fn),
    timeout() {
      return this;
    },
    emit(type, data, cb) {
      sent.push({ type, data });
      if (type === "action") cb(null, { ok: true });
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
  assert.match(c.doc.body.textContent, /Establish a channel/);
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
