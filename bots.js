"use strict";
// Decisions use only the same filtered view sent to the bot's own seat.
const { MAP, CARDS } = require("./public/shared");
function decide(v) {
  const p = v.players.find((x) => x.id === v.me.id),
    id = p.id;
  const occupied = (n) => Object.values(n.units).reduce((a, b) => a + b, 0);
  if (v.battle) {
    const b = v.battle;
    if (![b.attacker, b.defender].includes(id) || b.locked.includes(id))
      return null;
    const card = v.me.hand.find((c) => CARDS[c.kind].bonus > 0);
    return {
      type: "commit",
      battleId: b.id,
      supply: Math.min(3, p.supply),
      cardId: card?.id || null,
    };
  }
  const offer = v.offers.find((o) => o.to === id);
  if (offer) {
    const from = v.players.find((x) => x.id === offer.from);
    const goodPact =
      offer.kind === "pact" &&
      !p.ally &&
      !from.ally &&
      !v.nodes.some(
        (n) =>
          (n.owner === id && n.units[from.id]) ||
          (n.owner === from.id && n.units[id]),
      );
    const goodTrade =
      offer.kind === "trade" &&
      p.supply >= offer.wantSupply &&
      p.intel >= offer.wantIntel &&
      from.supply >= offer.giveSupply &&
      from.intel >= offer.giveIntel &&
      p.supply - offer.wantSupply + offer.giveSupply <= 30 &&
      p.intel - offer.wantIntel + offer.giveIntel <= 30 &&
      from.supply - offer.giveSupply + offer.wantSupply <= 30 &&
      from.intel - offer.giveIntel + offer.wantIntel <= 30 &&
      offer.giveSupply + offer.giveIntel >= offer.wantSupply + offer.wantIntel;
    return {
      type: goodPact || goodTrade ? "accept" : "cancel",
      offerId: offer.id,
    };
  }
  if (v.players[v.turn]?.id !== id) return null;
  const ownSites = v.nodes.filter(
    (n) => MAP[n.id].site && n.owner === id,
  ).length;
  const ally = v.players.find((x) => x.id === p.ally);
  const allySites = ally
    ? v.nodes.filter((n) => MAP[n.id].site && n.owner === ally.id).length
    : 0;
  if (
    !p.signal &&
    p.actions &&
    ((!ally && ownSites >= 2) ||
      (ally &&
        ownSites >= 1 &&
        allySites >= 1 &&
        ownSites + allySites >= 3 &&
        ally.actions &&
        p.barredRound !== v.round &&
        ally.barredRound !== v.round))
  )
    return { type: "signal" };
  const targets = v.nodes.filter(
    (n) =>
      MAP[n.id].home < 0 &&
      n.owner !== id &&
      (!p.ally || n.owner !== p.ally) &&
      (n.units[id] ||
        (p.faction === 0 &&
          !p.used.tag &&
          !occupied(n) &&
          MAP[n.id].links.some((i) => v.nodes[i].units[id]))) &&
      !Object.entries(n.units).some(([x, c]) => x !== id && c),
  );
  targets.sort((a, b) => Number(MAP[b.id].site) - Number(MAP[a.id].site));
  if (p.supply && targets.length) return { type: "tag", node: targets[0].id };
  const owned = v.nodes.filter(
    (n) =>
      n.owner === id &&
      !Object.entries(n.units).some(([x, c]) => x !== id && c),
  );
  const deployed = v.nodes.reduce((sum, n) => sum + (n.units[id] || 0), 0);
  if (deployed < 6 && p.supply >= 2 && owned.length)
    return {
      type: "recruit",
      node: owned.find((n) => n.units[id])?.id ?? owned[0].id,
      count: Math.min(3, 12 - deployed, p.supply),
    };
  const buildingCost =
    3 +
    (v.event.kind === "build" ? 1 : 0) -
    (p.faction === 2 && !p.used.build ? 1 : 0);
  if (
    owned.length >= 2 &&
    p.supply >= buildingCost + 2 &&
    owned.every((n) => n.structure !== "mural") &&
    owned.some((n) => !n.structure)
  )
    return {
      type: "build",
      node: owned.find((n) => !n.structure).id,
      structure: "mural",
    };
  const possible = [];
  for (const n of v.nodes.filter((n) => n.units[id]))
    for (const i of MAP[n.id].links) {
      const t = v.nodes[i];
      if ((MAP[i].home >= 0 && t.owner !== id) || t.units[p.ally]) continue;
      const defenders = occupied(t) - (t.units[id] || 0);
      if (defenders >= n.units[id]) continue;
      const desired = v.nodes.filter(
        (x) =>
          MAP[x.id].site && x.owner !== id && (!p.ally || x.owner !== p.ally),
      );
      const near = desired.length
        ? Math.min(
            ...desired.map((x) =>
              Math.max(
                Math.abs(MAP[i].q - MAP[x.id].q),
                Math.abs(MAP[i].r - MAP[x.id].r),
                Math.abs(MAP[i].q + MAP[i].r - MAP[x.id].q - MAP[x.id].r),
              ),
            ),
          )
        : 0;
      let score =
        (MAP[i].site && t.owner !== id ? 15 : 0) +
        (t.owner !== id && (!p.ally || t.owner !== p.ally) ? 4 : 0) -
        near * 3 -
        defenders * 2 -
        (t.units[id] ? 3 : 0);
      possible.push({
        score,
        action: { type: "move", from: n.id, to: i, count: n.units[id] },
      });
    }
  possible.sort((a, b) => b.score - a.score);
  if (possible.length) return possible[0].action;
  if (p.supply >= buildingCost && owned.some((n) => !n.structure))
    return {
      type: "build",
      node: owned.find((n) => !n.structure).id,
      structure: "mural",
    };
  return { type: "gather" };
}
module.exports = { decide };
