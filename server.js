"use strict";
const express = require("express");
const http = require("node:http");
const { Server } = require("socket.io");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const engine = require("./engine");

function createGameServer({
  dataDir = path.join(__dirname, "data"),
  port = 3000,
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "match.json");
  let state;
  if (fs.existsSync(file)) {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
    if (state.schema !== 1)
      throw new Error(
        "Unsupported saved game version. Keep data/match.json and contact the developer.",
      );
  } else {
    state = engine.initial();
    state.hostCode = crypto.randomBytes(6).toString("hex").toUpperCase();
  }
  function save(next) {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(tmp, file);
    state = next;
  }
  save(state);
  const app = express(),
    server = http.createServer(app);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.get("/health", (_, res) => res.json({ ok: true, game: "Cold Static" }));
  app.use(
    express.static(path.join(__dirname, "public"), { etag: true, maxAge: 0 }),
  );
  const io = new Server(server, {
    maxHttpBufferSize: 16384,
    serveClient: true,
    allowRequest: (req, done) => {
      const origin = req.headers.origin;
      try {
        done(null, !origin || new URL(origin).host === req.headers.host);
      } catch {
        done(null, false);
      }
    },
  });
  const offline = new Map(state.players.map((p) => [p.id, Date.now()]));
  const online = () => [
    ...new Set(
      [...io.sockets.sockets.values()]
        .map((s) => s.data.playerId)
        .filter(Boolean),
    ),
  ];
  function addresses() {
    const p = server.address()?.port || port;
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter((n) => n && !n.internal && n.family === "IPv4")
      .map((n) => `http://${n.address}:${p}`);
    return { local: `http://localhost:${p}`, lan: ips };
  }
  function send(socket) {
    if (!socket.data.playerId) {
      socket.emit("state", {
        status: state.status,
        version: state.version,
        players: state.players.map((p) => ({
          id: p.id,
          name: p.name,
          faction: p.faction,
          online: online().includes(p.id),
        })),
        me: null,
      });
      return;
    }
    const v = engine.view(state, socket.data.playerId, online());
    v.isHost = state.hostId === socket.data.playerId;
    v.addresses = v.isHost ? addresses() : null;
    v.serverTime = Date.now();
    v.offlineSince = Object.fromEntries(offline);
    socket.emit("state", v);
  }
  function broadcast() {
    for (const socket of io.sockets.sockets.values()) send(socket);
  }
  const check = (v, m) => {
    if (!v) throw new Error(m);
  };
  io.on("connection", (socket) => {
    send(socket);
    let windowAt = Date.now(),
      requests = 0;
    function limit() {
      if (Date.now() - windowAt > 10000) {
        windowAt = Date.now();
        requests = 0;
      }
      check(++requests <= 80, "Too many requests. Wait a few seconds.");
    }
    socket.on("join", (a, ack) => {
      if (typeof ack !== "function") return;
      try {
        limit();
        check(a && typeof a === "object", "Invalid join request.");
        let p;
        if (a.token) {
          p = state.players.find((p) => p.token === a.token);
          check(
            p,
            "Reconnect token not recognized. Use a current seat token or join the lobby.",
          );
        } else {
          check(
            state.status === "lobby",
            "This match is underway. Rejoin with the same browser or your private seat token.",
          );
          check(state.players.length < 6, "All six seats are occupied.");
          const name = typeof a.name === "string" ? a.name.trim() : "";
          check(
            name.length >= 1 && name.length <= 24,
            "Use a name of 1–24 characters.",
          );
          check(
            !state.players.some(
              (p) => p.name.toLowerCase() === name.toLowerCase(),
            ),
            "That name is already seated.",
          );
          const next = structuredClone(state);
          p = {
            id: crypto.randomUUID(),
            token: crypto.randomBytes(24).toString("hex"),
            name,
            faction: [0, 1, 2, 3, 4, 5].find(
              (f) => !next.players.some((p) => p.faction === f),
            ),
          };
          next.players.push(p);
          next.version++;
          save(next);
        }
        socket.data.playerId = p.id;
        offline.delete(p.id);
        ack({ ok: true, token: p.token });
        broadcast();
      } catch (e) {
        ack({ ok: false, error: e.message });
      }
    });
    socket.on("action", (a, ack) => {
      if (typeof ack !== "function") return;
      try {
        limit();
        const id = socket.data.playerId;
        check(id, "Join a crew first.");
        check(
          a &&
            typeof a.id === "string" &&
            a.id.length >= 8 &&
            a.id.length <= 100 &&
            a.action &&
            typeof a.action.type === "string",
          "Malformed action.",
        );
        const key = id + ":" + a.id;
        if (state.receipts[key]) {
          ack({ ok: true, duplicate: true });
          send(socket);
          return;
        }
        const action = a.action;
        if (action.type !== "commit")
          check(
            a.version === state.version,
            "The city changed. Review the latest state, then try again.",
          );
        let next;
        if (
          [
            "host",
            "faction",
            "duration",
            "start",
            "reset",
            "remove",
            "skip",
          ].includes(action.type)
        ) {
          next = structuredClone(state);
          const p = next.players.find((p) => p.id === id);
          if (action.type === "host") {
            check(
              typeof action.code === "string" &&
                action.code.toUpperCase() === state.hostCode,
              "Host code does not match the server terminal.",
            );
            check(
              !state.hostId || state.hostId === id,
              "Another player already holds host control.",
            );
            next.hostId = id;
          } else if (action.type === "faction") {
            check(state.status === "lobby", "Factions lock when play begins.");
            check(
              Number.isInteger(action.faction) &&
                action.faction >= 0 &&
                action.faction < 6,
              "Choose a faction.",
            );
            check(
              !next.players.some(
                (x) => x.id !== id && x.faction === action.faction,
              ),
              "That faction is taken.",
            );
            p.faction = action.faction;
          } else {
            check(state.hostId === id, "Only the host can do this.");
            if (action.type === "start") {
              check(
                state.players.every((p) => online().includes(p.id)),
                "All six players must be connected to start.",
              );
              engine.start(next, Date.now());
            }
            if (action.type === "duration") {
              check(state.status === "lobby", "Timer locks when play begins.");
              check(
                [180, 210, 240].includes(action.minutes),
                "Choose 180, 210, or 240 minutes.",
              );
              next.duration = action.minutes;
            }
            if (action.type === "reset") {
              next = {
                ...engine.initial(),
                players: next.players.map(({ id, token, name, faction }) => ({
                  id,
                  token,
                  name,
                  faction,
                })),
                hostCode: next.hostCode,
                hostId: id,
                duration: next.duration,
                version: next.version,
                receipts: next.receipts,
              };
            }
            if (action.type === "remove") {
              check(state.status === "lobby", "Seats lock during play.");
              check(action.target !== id, "Host cannot remove their own seat.");
              check(
                next.players.some((p) => p.id === action.target),
                "Seat not found.",
              );
              check(
                !online().includes(action.target),
                "Only disconnected seats can be removed.",
              );
              next.players = next.players.filter((p) => p.id !== action.target);
            }
            if (action.type === "skip") {
              check(
                state.status === "playing" && !state.battle,
                "Can only pass a turn outside combat.",
              );
              const target = state.players[state.turn];
              check(
                !online().includes(target.id) &&
                  offline.has(target.id) &&
                  Date.now() - offline.get(target.id) >= 60000,
                "Active crew must be disconnected for at least 60 seconds.",
              );
              next = engine.apply(state, target.id, { type: "pass" });
            }
          }
          if (action.type !== "skip") next.version++;
        } else next = engine.apply(state, id, action);
        next.receipts[key] = true;
        const keys = Object.keys(next.receipts);
        if (keys.length > 4096)
          for (const k of keys.slice(0, keys.length - 4096))
            delete next.receipts[k];
        save(next);
        ack({ ok: true });
        broadcast();
      } catch (e) {
        ack({ ok: false, error: e.message });
        send(socket);
      }
    });
    socket.on("sync", () => {
      try {
        limit();
        send(socket);
      } catch {}
    });
    socket.on("disconnect", () => {
      const id = socket.data.playerId;
      if (id && !online().includes(id)) offline.set(id, Date.now());
      broadcast();
    });
  });
  return {
    app,
    server,
    io,
    addresses,
    hostCode: state.hostCode,
    getState: () => structuredClone(state),
    close: () =>
      new Promise((resolve) => io.close(() => server.close(() => resolve()))),
  };
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const game = createGameServer({ port });
  game.server.listen(port, "0.0.0.0", () => {
    console.log("\nCOLD STATIC — local game server");
    console.log("Host code: " + game.hostCode + " (enter this in the lobby)");
    console.log("This computer: " + game.addresses().local);
    console.log(
      "Other laptops: " +
        (game.addresses().lan.join("  or  ") ||
          "Find your Wi-Fi IPv4 address with ipconfig"),
    );
    console.log("Keep this terminal open. State saves in data/match.json.\n");
  });
}
module.exports = { createGameServer };
