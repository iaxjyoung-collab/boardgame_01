"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { io } = require("socket.io-client");
const engine = require("../engine");
const { decide } = require("../bots");
const { createGameServer } = require("../server");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = (s, e, d) =>
  new Promise((resolve, reject) =>
    s.timeout(2000).emit(e, d, (err, r) => (err ? reject(err) : resolve(r))),
  );
async function connect(game) {
  const s = io(`http://127.0.0.1:${game.server.address().port}`, {
    transports: ["websocket"],
    reconnection: false,
  });
  await once(s, "connect");
  return s;
}
async function listen(game) {
  game.server.listen(0, "127.0.0.1");
  await once(game.server, "listening");
}
async function waitFor(fn) {
  for (let i = 0; i < 40; i++) {
    if (fn()) return;
    await delay(100);
  }
  throw Error("Timed out waiting for bot");
}
for (const humans of [1, 2])
  test(`${humans} human seats fill with bots and pause without humans`, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cold-bot-"));
    const game = createGameServer({ dataDir: dir, port: 0 });
    const sockets = [];
    t.after(async () => {
      sockets.forEach((s) => s.disconnect());
      await game.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    await listen(game);
    for (let i = 0; i < humans; i++) {
      const s = await connect(game);
      sockets.push(s);
      assert.equal((await rpc(s, "join", { name: `Human ${i}` })).ok, true);
    }
    let seq = 0;
    const action = (a) =>
      rpc(sockets[0], "action", {
        id: `bot-test-${++seq}`,
        version: game.getState().version,
        action: a,
      });
    assert.equal(
      (await action({ type: "host", code: game.hostCode })).ok,
      true,
    );
    assert.equal((await action({ type: "tutorial", enabled: true })).ok, true);
    assert.equal((await action({ type: "fillBots" })).ok, true);
    let state = game.getState();
    assert.equal(state.players.filter((p) => p.bot).length, 6 - humans);
    assert.equal((await action({ type: "start" })).ok, true);
    const projected = engine.view(
      game.getState(),
      game.getState().players[0].id,
      [],
    );
    assert.deepEqual(projected.tutorial, { enabled: true, active: true });
    assert.equal(projected.players.filter((p) => p.bot).length, 6 - humans);
    assert.equal((await action({ type: "pass" })).ok, true);
    if (humans === 2) {
      const result = await rpc(sockets[1], "action", {
        id: "human-2-pass",
        version: game.getState().version,
        action: { type: "pass" },
      });
      assert.equal(result.ok, true);
    }
    const version = game.getState().version;
    await waitFor(() => game.getState().version > version);
    sockets.forEach((s) => s.disconnect());
    await delay(100);
    const paused = game.getState().version;
    await delay(900);
    assert.equal(game.getState().version, paused);
  });
test("bot receives only its projected private view, and commits without reading opponent secrets", () => {
  const s = engine.initial();
  s.players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    faction: i,
    bot: i === 0,
    token: `secret${i}`,
  }));
  engine.start(s, Date.now());
  s.battle = {
    id: "battle",
    from: 7,
    to: 1,
    count: 2,
    attacker: "p0",
    defender: "p1",
    commitments: { p1: { supply: 3, card: s.players[1].hand[0] } },
  };
  const view = engine.view(s, "p0", []);
  assert.equal(view.battle.commitments, undefined);
  assert.equal(JSON.stringify(view).includes(s.players[1].hand[0].id), false);
  assert.equal(decide(view).type, "commit");
});
test("pending bot combat resumes after server restart and human reconnect", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cold-restart-"));
  let game = createGameServer({ dataDir: dir, port: 0 });
  let s;
  t.after(async () => {
    s?.disconnect();
    await game.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await listen(game);
  s = await connect(game);
  const joined = await rpc(s, "join", { name: "Human" });
  let seq = 0;
  const act = (a) =>
    rpc(s, "action", {
      id: `restart-${++seq}`,
      version: game.getState().version,
      action: a,
    });
  await act({ type: "host", code: game.hostCode });
  await act({ type: "fillBots" });
  await act({ type: "start" });
  s.disconnect();
  await game.close();
  const file = path.join(dir, "match.json");
  const state = JSON.parse(fs.readFileSync(file));
  const bot = state.players[1];
  state.battle = {
    id: "restart-battle",
    from: 9,
    to: 1,
    count: 1,
    attacker: bot.id,
    defender: state.players[0].id,
    commitments: {},
  };
  state.nodes[1].units[state.players[0].id] = 1;
  fs.writeFileSync(file, JSON.stringify(state));
  game = createGameServer({ dataDir: dir, port: 0 });
  await listen(game);
  await delay(900);
  assert.deepEqual(game.getState().battle.commitments, {});
  s = await connect(game);
  assert.equal((await rpc(s, "join", { token: joined.token })).ok, true);
  await waitFor(() => !!game.getState().battle.commitments[bot.id]);
});
test("host takeover restores the original human seat and locked commitment", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cold-takeover-"));
  let game = createGameServer({
    dataDir: dir,
    port: 0,
    botDelayMs: 30,
    takeoverDelayMs: 100,
  });
  let sockets = [];
  t.after(async () => {
    sockets.forEach((s) => s.disconnect());
    await game.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await listen(game);
  for (let i = 0; i < 2; i++) {
    const sock = await connect(game);
    sockets.push(sock);
    assert.equal((await rpc(sock, "join", { name: `Human ${i}` })).ok, true);
  }
  const token = game.getState().players[1].token,
    target = game.getState().players[1].id;
  let seq = 0;
  const act = (a) =>
    rpc(sockets[0], "action", {
      id: `takeover-${++seq}`,
      version: game.getState().version,
      action: a,
    });
  await act({ type: "host", code: game.hostCode });
  await act({ type: "fillBots" });
  await act({ type: "start" });
  assert.equal((await act({ type: "takeover", target })).ok, false);
  sockets[1].disconnect();
  await delay(30);
  assert.equal((await act({ type: "takeover", target })).ok, false);
  await delay(100);
  assert.equal((await act({ type: "takeover", target })).ok, true);
  assert.equal(game.getState().players[1].botTakeover, true);
  assert.equal((await act({ type: "reset" })).ok, true);
  assert.equal(game.getState().players[1].botTakeover, true);
  sockets[1] = await connect(game);
  assert.equal((await rpc(sockets[1], "join", { token })).ok, true);
  assert.equal(game.getState().players[1].bot, false);
  assert.equal(game.getState().players[1].botTakeover, false);
});
test("human offers delay bot operations for a bounded grace period", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cold-offer-"));
  let game = createGameServer({
    dataDir: dir,
    port: 0,
    botDelayMs: 30,
    offerGraceMs: 500,
  });
  let s;
  t.after(async () => {
    s?.disconnect();
    await game.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await listen(game);
  s = await connect(game);
  const joined = await rpc(s, "join", { name: "Human" });
  let seq = 0;
  const act = (a) =>
    rpc(s, "action", {
      id: `offer-test-${++seq}`,
      version: game.getState().version,
      action: a,
    });
  await act({ type: "host", code: game.hostCode });
  await act({ type: "fillBots" });
  await act({ type: "start" });
  s.disconnect();
  await game.close();
  const file = path.join(dir, "match.json"),
    state = JSON.parse(fs.readFileSync(file));
  state.turn = 1;
  state.offers = [
    {
      id: "offer1",
      from: state.players[2].id,
      to: state.players[0].id,
      kind: "trade",
      giveSupply: 1,
      giveIntel: 0,
      wantSupply: 0,
      wantIntel: 0,
    },
  ];
  fs.writeFileSync(file, JSON.stringify(state));
  game = createGameServer({
    dataDir: dir,
    port: 0,
    botDelayMs: 30,
    offerGraceMs: 500,
  });
  await listen(game);
  s = await connect(game);
  await rpc(s, "join", { token: joined.token });
  const version = game.getState().version;
  await delay(250);
  assert.equal(game.getState().version, version);
  await waitFor(() => game.getState().version > version);
  assert.equal(game.getState().offers.length, 0);
});
test("eighth-round fallback identifies round limit", () => {
  let s = engine.initial();
  s.players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    faction: i,
  }));
  engine.start(s, Date.now());
  s.round = 8;
  s.endsAt = Date.now() + 1000000;
  for (const p of s.players) p.actions = 0;
  s.players[s.turn].actions = 1;
  s = engine.apply(s, s.players[s.turn].id, { type: "pass" });
  assert.equal(s.result.reason, "Eight-round score");
});
test("rejoining a takeover leaves a locked combat commitment intact", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cold-lock-"));
  const state = engine.initial();
  state.hostCode = "TESTHOST";
  state.players = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    faction: i,
    token: `token-${i}`,
    bot: i === 0,
    botTakeover: i === 0,
  }));
  engine.start(state, Date.now());
  const locked = { supply: 2, card: null };
  state.battle = {
    id: "locked-battle",
    from: 7,
    to: 1,
    count: 2,
    attacker: "p0",
    defender: "p1",
    commitments: { p0: locked },
  };
  fs.writeFileSync(path.join(dir, "match.json"), JSON.stringify(state));
  const game = createGameServer({ dataDir: dir, port: 0 });
  let sock;
  t.after(async () => {
    sock?.disconnect();
    await game.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await listen(game);
  sock = await connect(game);
  assert.equal((await rpc(sock, "join", { token: "token-0" })).ok, true);
  assert.equal(game.getState().players[0].bot, false);
  assert.deepEqual(game.getState().battle.commitments.p0, locked);
});

test("five bots and a passing human complete a legal match without a scheduler fallback", () => {
  for (let campaign = 0; campaign < 3; campaign++) {
    let state = engine.initial();
    state.players = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      name: `Crew ${i}`,
      faction: i,
      bot: i > 0,
    }));
    engine.start(state, 0);
    let decisions = 0;
    while (state.status === "playing") {
      assert.ok(++decisions < 350, "Bots must make progress toward an ending");
      let actor, action;
      if (state.battle) {
        actor = [state.battle.attacker, state.battle.defender].find(
          (id) => !state.battle.commitments[id],
        );
        action =
          actor === "p0"
            ? {
                type: "commit",
                battleId: state.battle.id,
                supply: 0,
                cardId: null,
              }
            : decide(engine.view(state, actor));
      } else {
        actor = state.players[state.turn].id;
        action =
          actor === "p0" ? { type: "pass" } : decide(engine.view(state, actor));
      }
      assert.ok(action, "The active crew must have a plan");
      state = engine.apply(state, actor, action, 1);
      for (const node of state.nodes)
        assert.ok(
          Object.keys(node.units).length <= 1,
          "Combat cannot leave enemy units together",
        );
    }
    assert.ok(state.result.winners.length > 0);
    assert.ok(state.round >= 1 && state.round <= 8);
  }
});
