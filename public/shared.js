/* Public rule definitions; no live private state belongs in this file. */
(function (root) {
  const FACTIONS = [
    {
      name: "The Underprint",
      short: "UP",
      color: "#47c8bc",
      ability:
        "Once per round, tag an adjacent empty district without moving there.",
    },
    {
      name: "Glass Ministry",
      short: "GM",
      color: "#9ca9e1",
      ability:
        "Your towers can inspect opponents within two connections instead of one.",
    },
    {
      name: "Rust Union",
      short: "RU",
      color: "#e6a660",
      ability: "Your first tower or mural each round costs 1 less Supply.",
    },
    {
      name: "Night Couriers",
      short: "NC",
      color: "#83b9e4",
      ability:
        "Once per round, move through one hostile district to a district beyond it.",
    },
    {
      name: "Choir Zero",
      short: "CZ",
      color: "#c89ae6",
      ability:
        "Once per round, one mural spreads influence to two different adjacent districts.",
    },
    {
      name: "The Red Ledger",
      short: "RL",
      color: "#ec777d",
      ability:
        "Once per round, reclaim 1 Supply from a revealed combat commitment.",
    },
  ];
  const CARDS = {
    surge: { name: "Signal surge", text: "+2 combat strength.", bonus: 2 },
    intercept: {
      name: "Counterfrequency",
      text: "+1 strength; cancel the opponent’s card strength bonus.",
      bonus: 1,
    },
    evac: {
      name: "Ghost route",
      text: "If you lose, prevent your one operative casualty.",
      bonus: 0,
    },
    feint: {
      name: "Paper army",
      text: "After combat, refund up to 2 of your committed Supply.",
      bonus: 0,
    },
    falseflag: {
      name: "False intelligence",
      text: "+3 strength if you commit 0 Supply; otherwise +0.",
      bonus: 0,
    },
  };
  const EVENTS = [
    { name: "Dead air", text: "No city modifier this round.", kind: "none" },
    {
      name: "Ration convoy",
      text: "Every crew receives 2 extra Supply.",
      kind: "supply",
    },
    {
      name: "Intercepted dispatch",
      text: "Every crew receives 1 extra Intel.",
      kind: "intel",
    },
    {
      name: "Pirate frequency",
      text: "Every crew draws one Operation card (hand limit 3).",
      kind: "cards",
    },
    {
      name: "Concrete rain",
      text: "New construction costs 1 additional Supply this round.",
      kind: "build",
    },
    {
      name: "Quiet channels",
      text: "The Gather action produces 1 additional Intel this round.",
      kind: "gather",
    },
    {
      name: "Black market",
      text: "Every crew receives 1 Supply and 1 Intel.",
      kind: "market",
    },
    {
      name: "Final transmission",
      text: "No modifier. The city is listening.",
      kind: "none",
    },
  ];
  const coordinates = [
    [0, 0],
    [-1, 0],
    [0, -1],
    [1, -1],
    [1, 0],
    [0, 1],
    [-1, 1],
    [-2, 0],
    [-1, -1],
    [0, -2],
    [1, -2],
    [2, -2],
    [2, -1],
    [2, 0],
    [1, 1],
    [0, 2],
    [-1, 2],
    [-2, 2],
    [-2, 1],
  ];
  const names = [
    "Central Relay",
    "Floodline Radio",
    "The Archive",
    "Ash Market",
    "Signal Exchange",
    "Ministry of Truth",
    "Underpass",
    "North Docks",
    "Cold Storage",
    "Glass House",
    "Checkpoint Nine",
    "Iron Yard",
    "The Foundry",
    "Courier Terminal",
    "Rain Gardens",
    "Chapel Zero",
    "Sunken Cinema",
    "Ledger Vault",
    "Old Embassy",
  ];
  const homeIds = [7, 9, 11, 13, 15, 17],
    siteIds = [0, 1, 2, 4, 5];
  const MAP = coordinates.map(([q, r], id) => ({
    id,
    name: names[id],
    q,
    r,
    x: 470 + 148 * q + 74 * r,
    y: 365 + 128 * r,
    home: homeIds.indexOf(id),
    site: siteIds.includes(id),
    links: coordinates.flatMap(([a, b], i) =>
      Math.max(Math.abs(q - a), Math.abs(r - b), Math.abs(q + r - a - b)) === 1
        ? [i]
        : [],
    ),
  }));
  const RULES = `OBJECTIVE\nAt the end of a round, hold 3 Broadcast Sites alone, or 4 as a formal pair with each partner holding at least one. Each winner must have announced a Signal Attempt before taking their third action that round. For a pair, either member may announce while both still have an action left. Announcing is free and public. Break a pact and both former partners cannot share a victory that round; either can still win alone.\n\nSETUP & ROUND\nSix crews; 8 rounds; choose a 180–240 minute timer in the lobby. Each starts at its protected hideout with 4 operatives, 6 Supply, 3 Intel, and 2 private cards. Each round grants 3 Supply plus 1 per two non-hideout districts, and 2 Intel; murals grant 1 extra Supply each. Resources cap at 30. Reveal one city event. Take 3 actions each, one at a time clockwise, rotating the starting crew each round. No action clock; disconnected seats can reconnect. Host may pass a disconnected active seat after 60 seconds. The timer never interrupts a round or a battle.\n\nACTIONS (one action each)\nRecruit: 1 Supply per operative, 1–3 at any owned district; maximum 12 deployed, including fighters in combat.\nMove: move 1 or more operatives along a connection. Entering an enemy group starts combat. Couriers may once per round cross one hostile non-hideout district to land two connections away. Allies cannot share occupied districts. Other crews’ hideouts cannot be entered.\nTag: spend 1 Supply to claim a non-hideout, non-allied district with your operatives and no enemy operatives. Underprint can once per round tag an empty district adjacent to its units instead. Buildings change hands, influence clears.\nBuild: spend 3 Supply for a tower or mural at an owned district (one structure per district; no replacement). Rain adds 1; Rust discounts its first build by 1.\nSpread: each mural acts once per round for 1 Supply, adding one influence to an adjacent unoccupied, non-allied, non-hideout district. Choir may once per round select two different adjacent targets for that same cost. At two influence markers, claim the district immediately; its structure transfers. Enemy presence blocks spreading.\nGather: gain 2 Supply and 1 Intel (Quiet channels adds 1 Intel).\nExplore: costs 1 Intel; draw one private Operation card if below the limit of 3. First entry into a street district also reveals a cache: 2 Supply, 1 Intel, or one card.\nScan: costs 1 Intel; choose your tower and an enemy with units in its range, inspect one random card and its current hand count. Normal range 1; Glass range 2. Reports are private historical observations, not live tracking.\nPass: take no operation.\n\nCOMBAT\nBoth fighters privately lock 0–3 Supply and optionally one card. Neither choice is revealed until both lock; choices cannot change. Strength = operatives + Supply + card bonus. Defender wins ties. Counterfrequency cancels only the opponent’s card bonus (two Counterfrequencies cancel each other). Both spend their Supply and discard their played card. Loser loses 1 operative unless Ghost route prevents it; survivors retreat automatically to the nearest owned district (shortest graph distance, lower district ID breaks ties). A defeated attacker returns to its origin. Winners take no casualties. Attackers must later Tag to claim ownership. Structures keep their owner until tagging; hostile occupiers block their use. No combat dice. Ledger’s first positive combat spend each round returns 1 Supply; Paper army refunds first, Ledger returns only still-spent Supply.\n\nDIPLOMACY\nOffer a pact or a trade at any time between operations; accepting transfers the specified Supply/Intel atomically. Offers expire when any operation is taken. Pacts need both players’ consent; maximum two per alliance. Break a pact free of actions for 2 Intel, even just before your attack. Your former partner gains 2 Supply and both of you cannot share a victory that round, including by fallback score. Solo victory remains possible. Promises are unenforceable. You cannot attack, tag, spread into, or scan your ally.\n\nSURVEILLANCE & SECRECY\nOperatives and territory are public. Only owners receive their cards and scan reports. Your towers passively expose the current hand count of opponents with operatives within range; use Scan to inspect a random card. The log never discloses unrevealed commitments or private draws. Hideouts cannot be captured; recruit there to recover. No elimination.\n\nWINNING & TIME LIMIT\nCheck announced Signal Attempts after all 18 actions. Among qualifying solo/pair contenders, most sites wins, then most districts. If still tied, play the next round. At round 8 or after the timer expires, finish the current round: check Signal first, then fallback. Fallback: 2 points/site + 1/other district; allied crews combine scores minus 3. An alliance containing a crew barred by betrayal this round is ineligible; a solo crew remains eligible. Highest score wins; tied contenders share victory. If no contender is eligible, no one secures the city: a deadlock ending.\n\nORDER & RECONNECT\nServer arrival order resolves public actions and offer acceptance. Combat locks may arrive in either order; resolution waits for both and applies once. An operation consumes its turn before any other operation can run. A Signal announcement can be made during combat. Alliances and trades wait until combat ends. If the server restarts, saved state, timer and private reconnect seats survive. Keep your browser storage; reconnect tokens are private. Host can reset to the lobby; all six players keep their seats and factions.`;
  const data = { FACTIONS, CARDS, EVENTS, MAP, RULES };
  if (typeof module !== "undefined") module.exports = data;
  else root.COLD = data;
})(typeof window !== "undefined" ? window : globalThis);
