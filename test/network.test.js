"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { io } = require("socket.io-client");
const { createGameServer } = require("../server");
const delay = () => new Promise((r) => setTimeout(r, 20));
function rpc(socket, event, data) {
  return new Promise((resolve, reject) =>
    socket
      .timeout(2500)
      .emit(event, data, (err, res) => (err ? reject(err) : resolve(res))),
  );
}
async function connect(url) {
  const sock = io(url, {
    transports: ["websocket"],
    autoConnect: false,
    reconnection: false,
  });
  sock.latest = null;
  sock.on("state", (s) => (sock.latest = s));
  const ready = once(sock, "connect");
  sock.connect();
  await ready;
  await delay();
  return sock;
}
async function waitState(sock, version) {
  for (let i = 0; i < 100; i++) {
    if (sock.latest?.version >= version) return sock.latest;
    await delay();
  }
  throw Error("State broadcast timed out");
}
test("six real clients: host validation, exactly-once operations, private battle, reconnect and persisted restart", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cold-static-test-"));
  let game = createGameServer({ dataDir: dir, port: 0 });
  let sockets = [];
  t.after(async () => {
    sockets.forEach((s) => s.disconnect());
    await game.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  game.server.listen(0, "127.0.0.1");
  await once(game.server, "listening");
  let url = `http://127.0.0.1:${game.server.address().port}`;
  const tokens = [];
  for (let i = 0; i < 6; i++) {
    const sock = await connect(url);
    sockets.push(sock);
    const r = await rpc(sock, "join", { name: "Agent " + i });
    assert.equal(r.ok, true);
    tokens.push(r.token);
  }
  let req = 0;
  const action = (i, a, opts = {}) =>
    rpc(sockets[i], "action", {
      id: opts.id || "request-" + ++req,
      version: opts.version ?? game.getState().version,
      action: a,
    });
  assert.equal((await action(0, { type: "host", code: "wrong" })).ok, false);
  assert.equal(
    (await action(0, { type: "host", code: game.hostCode })).ok,
    true,
  );
  assert.equal((await action(1, { type: "start" })).ok, false);
  assert.equal((await action(0, { type: "start" })).ok, true);
  assert.equal((await action(1, { type: "reset" })).ok, false);
  assert.equal((await action(1, { type: "gather" })).ok, false);
  let state = game.getState(),
    oldVersion = state.version,
    oldSupply = state.players[0].supply;
  assert.equal(
    (
      await action(
        0,
        { type: "gather" },
        { id: "duplicate-click", version: oldVersion },
      )
    ).ok,
    true,
  );
  const version = game.getState().version;
  assert.equal(
    (
      await action(
        0,
        { type: "gather" },
        { id: "duplicate-click", version: oldVersion },
      )
    ).duplicate,
    true,
  );
  assert.equal(game.getState().version, version);
  assert.equal(game.getState().players[0].supply, oldSupply + 2);
  assert.equal(
    (await action(1, { type: "gather" }, { version: oldVersion })).ok,
    false,
  );
  for (let i = 1; i < 6; i++)
    assert.equal((await action(i, { type: "gather" })).ok, true);
  assert.equal(
    (await action(0, { type: "move", from: 7, to: 1, count: 3 })).ok,
    true,
  );
  assert.equal(
    (await action(1, { type: "move", from: 9, to: 2, count: 3 })).ok,
    true,
  );
  for (let i = 2; i < 6; i++) await action(i, { type: "pass" });
  assert.equal(
    (await action(0, { type: "move", from: 1, to: 0, count: 3 })).ok,
    true,
  );
  assert.equal(
    (await action(1, { type: "move", from: 2, to: 0, count: 3 })).ok,
    true,
  );
  const bid = game.getState().battle.id,
    secret = game.getState().players[1].hand[0];
  assert.equal(
    (
      await action(1, {
        type: "commit",
        battleId: bid,
        supply: 2,
        cardId: secret.id,
      })
    ).ok,
    true,
  );
  const observer = await waitState(sockets[2], game.getState().version);
  assert.equal(observer.battle.own, null);
  assert.equal(Object.hasOwn(observer.battle, "commitments"), false);
  assert.equal(JSON.stringify(observer).includes(secret.id), false);
  assert.equal(JSON.stringify(observer).includes(tokens[1]), false);
  assert.equal(JSON.stringify(observer).includes(game.hostCode), false);
  const anon = await connect(url);
  sockets.push(anon);
  assert.equal(anon.latest.me, null);
  assert.equal(anon.latest.nodes, undefined);
  assert.equal((await rpc(anon, "join", { name: "Seventh" })).ok, false);
  // Interrupt the defender's connection with one commitment pending, then restore it.
  const savedHand = game.getState().players[0].hand;
  sockets[0].disconnect();
  sockets[0] = await connect(url);
  assert.equal((await rpc(sockets[0], "join", { token: tokens[0] })).ok, true);
  const restored = await waitState(sockets[0], game.getState().version);
  assert.deepEqual(restored.me.hand, savedHand);
  assert.ok(restored.battle);
  assert.equal(
    (await action(0, { type: "commit", battleId: bid, supply: 0 })).ok,
    true,
  );
  assert.equal(game.getState().battle, null);
  const beforeRestart = game.getState();
  sockets.forEach((s) => s.disconnect());
  await game.close();
  game = createGameServer({ dataDir: dir, port: 0 });
  game.server.listen(0, "127.0.0.1");
  await once(game.server, "listening");
  url = `http://127.0.0.1:${game.server.address().port}`;
  sockets = [];
  sockets.push(await connect(url));
  assert.equal((await rpc(sockets[0], "join", { token: tokens[0] })).ok, true);
  await waitState(sockets[0], beforeRestart.version);
  assert.deepEqual(game.getState(), beforeRestart);
  assert.equal(sockets[0].latest.isHost, true);
  assert.equal(
    (
      await action(
        0,
        { type: "gather" },
        { id: "duplicate-click", version: oldVersion },
      )
    ).duplicate,
    true,
  );
  assert.deepEqual(game.getState(), beforeRestart);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Cold Static/);
  assert.match(
    response.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assert.equal((await fetch(url + "/data/match.json")).status, 404);
  assert.equal((await fetch(url + "/engine.js")).status, 404);
  assert.equal((await fetch(url + "/shared.js")).status, 200);
  assert.equal((await fetch(url + "/socket.io/socket.io.js")).status, 200);
});
test("server rejects malformed payloads and preserves lobby on invalid start", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cold-static-test-")),
    game = createGameServer({ dataDir: dir, port: 0 });
  game.server.listen(0, "127.0.0.1");
  await once(game.server, "listening");
  const s = await connect(`http://127.0.0.1:${game.server.address().port}`);
  t.after(async () => {
    s.disconnect();
    await game.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  assert.equal((await rpc(s, "join", { name: "" })).ok, false);
  assert.equal((await rpc(s, "join", { name: "Host" })).ok, true);
  assert.equal(
    (
      await rpc(s, "action", {
        id: "claim-host",
        version: 1,
        action: { type: "host", code: game.hostCode },
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await rpc(s, "action", {
        id: "start-now",
        version: 2,
        action: { type: "start" },
      })
    ).ok,
    false,
  );
  assert.equal(game.getState().status, "lobby");
  assert.equal((await rpc(s, "action", { id: "x", action: null })).ok, false);
  assert.equal((await rpc(s, "action", null)).ok, false);
});
