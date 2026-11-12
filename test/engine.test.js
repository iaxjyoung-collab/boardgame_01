"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine");
const { MAP } = require("../public/shared");
function fixture() {
  const s = E.initial();
  s.players = Array.from({ length: 6 }, (_, i) => ({
    id: "p" + i,
    name: "Crew " + i,
    faction: i,
    token: "secret" + i,
  }));
  E.start(s, 0);
  s.event = { kind: "none" };
  for (const p of s.players) {
    p.supply = 12;
    p.intel = 8;
    p.hand = [
      { id: p.id + "-a", kind: "surge" },
      { id: p.id + "-b", kind: "evac" },
    ];
  }
  return s;
}
function run(s, i, a, now = 1) {
  return E.apply(s, "p" + i, a, now);
}
function finishRound(s, now = 1) {
  const r = s.round;
  while (s.status === "playing" && s.round === r) {
    assert.ok(!s.battle);
    s = run(s, s.turn, { type: "pass" }, now);
  }
  return s;
}
test("setup is 19 connected nodes, six unique protected hideouts, five sites", () => {
  const s = fixture();
  assert.equal(s.nodes.length, 19);
  assert.equal(MAP.filter((n) => n.site).length, 5);
  assert.equal(
    s.players.reduce(
      (a, p) => a + s.nodes.reduce((v, n) => v + (n.units[p.id] || 0), 0),
      0,
    ),
    24,
  );
  const reached = new Set([0]);
  for (let step = 0; step < 19; step++)
    for (const id of [...reached]) MAP[id].links.forEach((i) => reached.add(i));
  assert.equal(reached.size, 19);
  for (const n of MAP)
    for (const i of n.links) assert.ok(MAP[i].links.includes(n.id));
});
test("wrong turn, invalid costs and malformed quantities leave original untouched", () => {
  const s = fixture(),
    before = structuredClone(s);
  assert.throws(() => run(s, 1, { type: "gather" }), /turn/);
  assert.throws(
    () => run(s, 0, { type: "recruit", node: 7, count: -1 }),
    /1–3/,
  );
  assert.throws(() => run(s, 0, { type: "tag", node: 9 }), /Hideouts/);
  s.players[0].supply = 0;
  assert.throws(
    () => run(s, 0, { type: "recruit", node: 7, count: 2 }),
    /Supply/,
  );
  s.players[0].supply = 12;
  assert.deepEqual(s, before);
});
test("one action per crew, three passes each, then rotate starter", () => {
  let s = fixture();
  s = finishRound(s);
  assert.equal(s.round, 2);
  assert.equal(s.turn, 1);
  assert.ok(s.players.every((p) => p.actions === 3));
});
test("Underprint remote tag is once a round; tagging transfers structures", () => {
  let s = fixture();
  s.nodes[1].structure = "mural";
  s = run(s, 0, { type: "tag", node: 1 });
  assert.equal(s.nodes[1].owner, "p0");
  assert.equal(s.nodes[1].structure, "mural");
  assert.equal(s.players[0].supply, 11);
  s.turn = 0;
  assert.throws(() => run(s, 0, { type: "tag", node: 8 }), /Tag where/);
});
test("Rust build discount, Rain surcharge, murals spread and claim at two markers", () => {
  let s = fixture();
  s.turn = 2;
  s.event.kind = "build";
  s = run(s, 2, { type: "build", node: 11, structure: "mural" });
  assert.equal(s.players[2].supply, 9);
  s.turn = 2;
  s = run(s, 2, { type: "spread", node: 11, targets: [3] });
  assert.equal(s.nodes[3].influence.p2, 1);
  s.turn = 2;
  assert.throws(
    () => run(s, 2, { type: "spread", node: 11, targets: [3] }),
    /already/,
  );
  s = finishRound(s);
  s.turn = 2;
  s = run(s, 2, { type: "spread", node: 11, targets: [3] });
  assert.equal(s.nodes[3].owner, "p2");
  assert.deepEqual(s.nodes[3].influence, {});
});
test("Choir spreads to two different districts; invalid second target rolls back cost", () => {
  let s = fixture();
  s.turn = 4;
  s.nodes[15].structure = "mural";
  const before = structuredClone(s);
  assert.throws(
    () => run(s, 4, { type: "spread", node: 15, targets: [5, 0] }),
    /adjacent/,
  );
  assert.deepEqual(s, before);
  s = run(s, 4, { type: "spread", node: 15, targets: [5, 14] });
  assert.equal(s.nodes[5].influence.p4, 1);
  assert.equal(s.nodes[14].influence.p4, 1);
  assert.equal(s.players[4].used.choir, true);
});
function battleFixture() {
  let s = fixture();
  s.nodes[1].units = { p0: 3 };
  s.nodes[0].units = { p1: 3 };
  s.nodes[0].owner = "p1";
  s.nodes[0].explored = true;
  s = run(s, 0, { type: "move", from: 1, to: 0, count: 3 });
  return s;
}
test("combat is hidden until both lock, defender wins ties, attacker retreats", () => {
  let s = battleFixture();
  const bid = s.battle.id;
  const b = structuredClone(s);
  s = run(s, 0, { type: "commit", battleId: bid, supply: 2 });
  assert.equal(s.players[0].supply, 12);
  assert.equal(s.players[0].actions, 2);
  const v = E.view(s, "p2");
  assert.deepEqual(v.battle.locked, ["p0"]);
  assert.equal(v.battle.own, null);
  assert.equal(Object.hasOwn(v.battle, "commitments"), false);
  assert.throws(
    () => run(s, 0, { type: "commit", battleId: bid, supply: 0 }),
    /already locked/,
  );
  assert.throws(
    () => run(s, 2, { type: "commit", battleId: bid, supply: 0 }),
    /combatants/,
  );
  s = run(s, 1, { type: "commit", battleId: bid, supply: 2 });
  assert.equal(s.battle, null);
  assert.equal(s.nodes[0].units.p1, 3);
  assert.equal(s.nodes[1].units.p0, 2);
  assert.equal(s.nodes[0].owner, "p1");
  assert.equal(s.players[0].supply, 10);
  assert.equal(s.turn, 1);
  assert.ok(b.battle);
  assert.throws(
    () => run(s, 0, { type: "commit", battleId: bid, supply: 0 }),
    /no longer/,
  );
});
test("false intel rewards zero commitment; Counterfrequency cancels bonus, Ghost route spares casualty", () => {
  let s = battleFixture();
  s.players[0].hand = [{ id: "fake", kind: "falseflag" }];
  s.players[1].hand = [{ id: "evac", kind: "evac" }];
  const bid = s.battle.id;
  s = run(s, 1, { type: "commit", battleId: bid, supply: 0, cardId: "evac" });
  s = run(s, 0, { type: "commit", battleId: bid, supply: 0, cardId: "fake" });
  assert.equal(s.nodes[0].units.p0, 3);
  assert.equal(s.nodes[9].units.p1, 7);
  assert.equal(s.nodes[0].owner, "p1");
  assert.equal(s.players[0].hand.length, 0);
  s = battleFixture();
  s.players[0].hand = [{ id: "fake", kind: "falseflag" }];
  s.players[1].hand = [{ id: "cancel", kind: "intercept" }];
  s = run(s, 0, {
    type: "commit",
    battleId: s.battle.id,
    supply: 0,
    cardId: "fake",
  });
  s = run(s, 1, {
    type: "commit",
    battleId: s.battle.id,
    supply: 0,
    cardId: "cancel",
  });
  assert.equal(s.nodes[0].units.p1, 3);
  assert.equal(s.nodes[1].units.p0, 2);
});
test("Ledger refunds once, without exceeding spent Supply after Paper army", () => {
  let s = battleFixture();
  s.players[0].faction = 5;
  s.players[0].hand = [{ id: "paper", kind: "feint" }];
  s = run(s, 0, {
    type: "commit",
    battleId: s.battle.id,
    supply: 3,
    cardId: "paper",
  });
  s = run(s, 1, { type: "commit", battleId: s.battle.id, supply: 0 });
  assert.equal(s.players[0].supply, 12);
  assert.equal(s.players[0].used.ledger, true);
});
test("cards, tokens, receipts and scan observations never enter another player view", () => {
  const s = fixture();
  s.players[0].reports = [{ target: "secret-target", card: "surge", count: 2 }];
  s.receipts.private = "secret-receipt";
  s.hostCode = "secret-host";
  const v = E.view(s, "p1"),
    str = JSON.stringify(v);
  for (const x of [
    "secret0",
    "secret-target",
    "secret-receipt",
    "secret-host",
    s.players[0].hand[0].id,
  ])
    assert.equal(str.includes(x), false);
  assert.equal(v.players[0].handCount, null);
  assert.equal(v.me.id, "p1");
});
test("Glass tower exposes counts at range 2, scan gives only viewer a historical report", () => {
  let s = fixture();
  s.nodes[0].owner = "p1";
  s.nodes[0].structure = "tower";
  s.nodes[13].units.p2 = 1;
  assert.equal(E.view(s, "p1").players[2].handCount, 2);
  assert.equal(E.view(s, "p0").players[2].handCount, null);
  s.turn = 1;
  s = run(s, 1, { type: "scan", node: 0, target: "p2" });
  assert.equal(E.view(s, "p1").me.reports.length, 1);
  assert.equal(E.view(s, "p2").me.reports.length, 0);
  assert.equal(s.players[1].intel, 7);
});
test("Couriers cross exactly one hostile district once per round", () => {
  let s = fixture();
  s.turn = 3;
  s.nodes[4].owner = "p2";
  s = run(s, 3, { type: "move", from: 13, to: 0, via: 4, count: 2 });
  assert.equal(s.nodes[0].units.p3, 2);
  assert.equal(s.players[3].used.courier, true);
  s.turn = 3;
  assert.throws(
    () => run(s, 3, { type: "move", from: 13, to: 0, via: 4, count: 1 }),
    /adjacent/,
  );
});
test("trade is consent based, atomic, private, and expires on operations", () => {
  let s = fixture();
  s = run(s, 0, {
    type: "offer",
    kind: "trade",
    target: "p1",
    giveSupply: 3,
    giveIntel: 0,
    wantSupply: 0,
    wantIntel: 2,
  });
  assert.equal(E.view(s, "p2").offers.length, 0);
  const oid = s.offers[0].id;
  s = run(s, 1, { type: "accept", offerId: oid });
  assert.equal(s.players[0].supply, 9);
  assert.equal(s.players[1].supply, 15);
  assert.equal(s.players[0].intel, 10);
  assert.throws(() => run(s, 1, { type: "accept", offerId: oid }), /expired/);
  s = run(s, 1, { type: "offer", kind: "pact", target: "p2" });
  s = run(s, 0, { type: "gather" });
  assert.equal(s.offers.length, 0);
});
test("declining one offer preserves other offers", () => {
  let s = fixture();
  s = run(s, 0, { type: "offer", kind: "pact", target: "p1" });
  const first = s.offers[0].id;
  s = run(s, 0, { type: "offer", kind: "pact", target: "p2" });
  s = run(s, 1, { type: "cancel", offerId: first });
  assert.equal(s.offers.length, 1);
  assert.equal(s.offers[0].to, "p2");
});
test("formal alliances need consent and betrayals have immediate real consequences", () => {
  let s = fixture();
  s = run(s, 0, { type: "offer", kind: "pact", target: "p1" });
  assert.equal(s.players[0].ally, null);
  s = run(s, 1, { type: "accept", offerId: s.offers[0].id });
  assert.equal(s.players[0].ally, "p1");
  s = run(s, 0, { type: "signal" });
  s = run(s, 0, { type: "break" });
  assert.equal(s.players[0].intel, 6);
  assert.equal(s.players[1].supply, 14);
  assert.equal(s.players[0].barredRound, 1);
  assert.equal(s.players[1].barredRound, 1);
  assert.equal(s.players[0].signal, false);
  assert.equal(s.players[0].ally, null);
  s = run(s, 0, { type: "signal" });
  assert.equal(s.players[0].signal, true);
  s = run(s, 0, { type: "offer", kind: "pact", target: "p2" });
  s = run(s, 2, { type: "accept", offerId: s.offers[0].id });
  assert.throws(() => run(s, 0, { type: "signal" }), /shared victory/);
});
test("solo signal win requires announcement and finishes the entire round", () => {
  let s = fixture();
  for (const i of [0, 1, 2]) s.nodes[i].owner = "p0";
  s = run(s, 0, { type: "signal" });
  assert.equal(s.status, "playing");
  s = finishRound(s);
  assert.equal(s.status, "finished");
  assert.equal(s.result.reason, "Hold the Signal");
  assert.deepEqual(s.result.winners[0].ids, ["p0"]);
  s = fixture();
  for (const i of [0, 1, 2]) s.nodes[i].owner = "p0";
  s = finishRound(s);
  assert.equal(s.status, "playing");
  assert.equal(s.round, 2);
});
test("allied win needs four sites and each partner holding at least one", () => {
  let s = fixture();
  s.players[0].ally = "p1";
  s.players[1].ally = "p0";
  for (const i of [0, 1, 2, 4]) s.nodes[i].owner = "p0";
  s = run(s, 0, { type: "signal" });
  s = finishRound(s);
  assert.equal(s.status, "playing");
  s.nodes[4].owner = "p1";
  s = run(s, 0, { type: "signal" });
  s = finishRound(s);
  assert.equal(s.status, "finished");
  assert.deepEqual(s.result.winners[0].ids, ["p0", "p1"]);
});
test("timer expires only at round end, fallback combines allied score minus 3", () => {
  let s = fixture();
  s.players[0].ally = "p1";
  s.players[1].ally = "p0";
  s.nodes[0].owner = "p0";
  s.nodes[1].owner = "p1";
  s = run(s, 0, { type: "pass" }, s.endsAt + 1);
  assert.equal(s.status, "playing");
  s = finishRound(s, s.endsAt + 2);
  assert.equal(s.status, "finished");
  assert.equal(s.result.reason, "Time-limit score");
  assert.equal(s.result.winners[0].score, 3);
});
test("betrayal bars shared wins but leaves solo victory possible", () => {
  let s = fixture();
  s.nodes[0].owner = "p0";
  s.players[0].barredRound = 1;
  s = finishRound(s, s.endsAt + 1);
  assert.deepEqual(s.result.winners[0].ids, ["p0"]);
  s = fixture();
  s.players[0].ally = "p1";
  s.players[1].ally = "p0";
  s.players[0].barredRound = 1;
  for (const i of [0, 1, 2, 4]) s.nodes[i].owner = "p0";
  s = finishRound(s, s.endsAt + 1);
  assert.ok(s.result.winners.every((g) => !g.ids.includes("p0")));
});
test("eight complete rounds always end; operatives cannot be eliminated from the game", () => {
  let s = fixture(),
    turns = 0;
  while (s.status === "playing") {
    s = run(s, s.turn, { type: "pass" });
    turns++;
    assert.ok(turns <= 144);
  }
  assert.equal(turns, 144);
  assert.equal(s.round, 8);
  assert.equal(s.result.winners.length, 6);
});
test("recovery recruiting, empty capture, resource caps and hand limits", () => {
  let s = fixture();
  s.nodes[7].units = {};
  s.players[0].supply = 30;
  s.players[0].intel = 30;
  s = run(s, 0, { type: "gather" });
  assert.equal(s.players[0].supply, 30);
  s.turn = 0;
  s = run(s, 0, { type: "recruit", node: 7, count: 3 });
  assert.equal(s.nodes[7].units.p0, 3);
  s.players[0].hand = [
    { id: "1", kind: "surge" },
    { id: "2", kind: "surge" },
    { id: "3", kind: "surge" },
  ];
  s.turn = 0;
  assert.throws(() => run(s, 0, { type: "explore" }), /full/);
});
module.exports = { fixture };
test("mixed-operation campaigns preserve troop, resource, privacy and round invariants", () => {
  let seed = 314159;
  const pick = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let campaign = 0; campaign < 5; campaign++) {
    let s = fixture(),
      steps = 0;
    while (s.status === "playing") {
      assert.ok(++steps < 400);
      if (s.battle) {
        for (const id of [s.battle.attacker, s.battle.defender]) {
          const p = s.players.find((p) => p.id === id);
          if (s.battle && !s.battle.commitments[id])
            s = E.apply(
              s,
              id,
              {
                type: "commit",
                battleId: s.battle.id,
                supply: Math.min(p.supply, pick(4)),
                cardId: p.hand.length && pick(2) ? p.hand[0].id : null,
              },
              1,
            );
        }
      } else {
        const p = s.players[s.turn],
          candidates = [
            { type: "gather" },
            { type: "explore" },
            { type: "pass" },
          ];
        for (const n of s.nodes) {
          if (n.owner === p.id) {
            candidates.push(
              {
                type: "build",
                node: n.id,
                structure: pick(2) ? "tower" : "mural",
              },
              { type: "recruit", node: n.id, count: pick(3) + 1 },
            );
            if (n.structure === "mural")
              for (const target of MAP[n.id].links)
                candidates.push({
                  type: "spread",
                  node: n.id,
                  targets: [target],
                });
          }
          if (n.units[p.id]) {
            candidates.push({ type: "tag", node: n.id });
            for (const target of MAP[n.id].links)
              candidates.push({
                type: "move",
                from: n.id,
                to: target,
                count: pick(n.units[p.id]) + 1,
              });
          } else if (p.faction === 0)
            candidates.push({ type: "tag", node: n.id });
        }
        let applied = false;
        while (candidates.length) {
          const a = candidates.splice(pick(candidates.length), 1)[0];
          try {
            s = E.apply(s, p.id, a, 1);
            applied = true;
            break;
          } catch {}
        }
        assert.ok(applied);
      }
      for (const n of s.nodes) {
        assert.ok(
          Object.keys(n.units).length <= 1,
          "Enemy units never coexist after resolution",
        );
        assert.ok(
          Object.values(n.units).every((v) => Number.isInteger(v) && v > 0),
        );
        if (MAP[n.id].home >= 0)
          assert.equal(n.owner, s.players[MAP[n.id].home].id);
      }
      for (const p of s.players) {
        assert.ok(
          p.supply >= 0 && p.supply <= 30 && p.intel >= 0 && p.intel <= 30,
        );
        assert.ok(p.hand.length <= 3);
        assert.ok(p.actions >= 0 && p.actions <= 3);
        const deployed =
          s.nodes.reduce((sum, n) => sum + (n.units[p.id] || 0), 0) +
          (s.battle?.attacker === p.id ? s.battle.count : 0);
        assert.ok(deployed <= 12);
        const v = E.view(s, p.id);
        for (const other of s.players.filter((x) => x.id !== p.id)) {
          assert.ok(!JSON.stringify(v).includes(other.token));
        }
      }
    }
    assert.equal(s.round, 8);
    assert.equal(s.status, "finished");
  }
});
