# Cold Static

An original strategy game for one to six human players, about graffiti, espionage and fragile alliances in a divided city. Bots fill the remaining seats so there are always six crews. Play solo on the host computer or with friends on the same local Wi-Fi. The host runs a small Node.js server; everyone plays in a browser. No accounts, cloud services, external assets or internet requests during play.

## Windows: install once

Only the host computer needs Node.js or this folder. Other players only need a modern browser.

1. Install **Node.js LTS** from <https://nodejs.org> before game night (Node 22 or 24 recommended; minimum Node 20). Use the standard Windows installer and its default options. Reopen your terminal after installation.
2. Extract the supplied **ColdStatic.zip** to a normal folder, for example `C:\Games\ColdStatic`. If using GitHub, **Code → Download ZIP** also works once the game files are uploaded there. Do not run the game from inside the ZIP.
3. Open that folder and double-click **install.cmd**. This downloads the locked server dependencies once. Wait for “Installation complete.” Internet is required only for this step and downloading Node/the game.

Alternatively, open PowerShell in the extracted game folder and run:

```powershell
npm.cmd ci --omit=dev
```

## Start and join on game night

1. For multiplayer, connect all participating laptops to the same Wi-Fi. Solo play works on the host computer. Use a normal home/private network; guest Wi-Fi may prevent laptops from talking to each other.
2. On the host, double-click **start-game.cmd**. Keep its terminal open for the whole game. The server binds to **0.0.0.0**, so it accepts local-network connections.
3. If Windows asks whether to allow Node.js through the firewall, allow it on **Private networks** for your home Wi-Fi. If you dismissed the prompt, use **Windows Security → Firewall & network protection → Allow an app through firewall → Change settings**, and enable the Private checkbox for Node.js JavaScript Runtime. Your Windows network profile should be Private for your trusted Wi-Fi.
4. On the host, open **http://localhost:3000**. Enter a callsign, then open **Host controls** and enter the **host code printed in the terminal**. The code grants host controls and is not included in browser state.
5. The terminal and host lobby show one or more join addresses, such as **http://192.168.1.42:3000**. Other laptops open that address. Use the Wi-Fi address if VPN/virtual adapter addresses also appear. `localhost` works only on the host itself.
6. Each human enters a different name and receives a faction. The host can use **Add one bot** or **Fill empty seats** so all six crew seats are occupied. For solo play, join yourself and fill the other five seats with bots. Bots are labeled in the lobby and standings, can be removed before starting, and use the same rules as humans. If a friend wants a full lobby seat, remove a bot first. Factions can be changed to an available one before starting.
7. The host chooses **180, 210 (default), or 240 minutes** and optionally checks **Guide us through the first round**, then clicks **Start game**. All six crew seats must contain a connected human or a bot. No spectator accounts are needed.

To find the correct local address manually, open PowerShell, run `ipconfig`, and look under **Wireless LAN adapter Wi-Fi → IPv4 Address**, for example `192.168.1.42`. The join address is `http://` + that address + `:3000`.

If port 3000 is occupied, open PowerShell in the game folder and run:

```powershell
$env:PORT = '3001'
npm.cmd start
```

Then join at `http://<host-Wi-Fi-IPv4>:3001`. For the normal port, leave `PORT` unset. If a friend cannot connect, first check the same Wi-Fi, correct IPv4/port, Windows Private firewall permission, and guest-network/client-isolation settings. No router port forwarding is needed.

## Reconnect, save and restart

- Refreshing or losing Wi-Fi does not lose a seat. The browser stores a private reconnect token and automatically restores that player's hand and state. **Do not clear site storage during a match.** The same address and port preserve the browser's saved seat.
- **Reconnect** lets a player privately copy their token. On another browser/device, open the host address, expand **Restore an existing crew**, and paste it. This also works if the host IP changes. Treat it as a password for that crew; keep it private.
- The server saves every successful mutation to **data/match.json** using an atomic file replacement, before acknowledging the action. Starting the server again from this same folder restores the match, pending combat locks, host control, reconnect tokens and timer. Time while the server is off still counts; finish the current round if the timer has elapsed.
- If a confirmation is lost, use **Retry last request**; the same request ID is reused. The server stores receipts and checks versions to prevent duplicate effects. A stale request fails with an explanation instead of acting on an outdated map.
- A disconnected active player pauses the turn. After 60 seconds, the host can use **Host controls → Pass disconnected turn**, or **Assign temporary bot** to continue that crew—including a disconnected combatant. The original player can reclaim control by restoring their existing token; a locked combat commitment stays unchanged. These controls show a live countdown. Bots pause when no human is connected.
- **Host controls → Return to lobby** replaces the current match after confirmation. Seats and factions are retained; all gameplay progress is cleared. This is also how to start a second game.
- To back up a game, stop the server and copy `data/match.json` somewhere private. Restore it into the same folder with the server stopped. `data/` is excluded from Git and release bundles.

## Optional first-round guide and contextual help

Enable **Guide us through the first round** in host setup before starting. Each player gets a five-part guide covering the objective, their faction/hideout, a real operation, tagging and round planning. The practice step advances after a successful operation, pauses for combat, and resumes afterward. **Skip guide** dismisses it locally; **First-round guide** in the header restores it. Progress survives refresh/reconnect and the guide disappears at round two. It never takes an action on your behalf or changes the game rules.

Question-mark buttons explain resources, actions, structures, cards and diplomacy. Hover or keyboard-focus them to read; click to keep help open. Press Escape, click again or click outside to close it. Costs and unavailable-action reasons remain visible without tooltips. The Move selector lists only legal destinations, highlights them on the map and warns before combat. The Rules dialog has quick basics, a search box and section navigation.

## Learn in 15 minutes

1. **The objective:** own three of the five starred Broadcast Sites at the end of a round. A formal pair needs four, with each holding at least one. Announce a free **Signal Attempt before your final action**; a pair must announce while both still have an action remaining.
2. **Your economy:** Supply pays for troops, tagging, construction and combat; Intel pays for new cards, scans and betrayal. You start with four operatives, six Supply, three Intel and two cards, then the first city event may add resources/cards. Each new round provides income. Both resources cap at 30.
3. **Your turn:** take one operation, then the next crew acts. Everyone takes three operations per round. Move, tag, recruit, build, spread, gather, explore, scan or pass. Select a district and an operation to see its cost and why it may be unavailable. The starting crew rotates each round.
4. **Control:** graffiti, not troops, marks ownership. Move into an empty district, then use a separate Tag operation to claim it. A mural can claim empty neighbouring districts through two influence markers. Captured structures transfer with ownership. Hideouts are permanent and protected, so nobody is eliminated.
5. **Conflict:** both fighters secretly commit 0–3 Supply and optionally a card. Strength is operatives + Supply + card effect; defender wins ties. Reveal together, spend the resources, discard the cards, and retreat the loser with one casualty. Attackers still need to Tag later. There are no combat dice.
6. **Pacts:** use Diplomacy to propose a two-person alliance or an immediate resource trade. Acceptance is required. Offers expire at the next operation. Pacts prevent hostile actions against each other. Betrayal costs two Intel, compensates the former partner with two Supply, and blocks **shared** victory for both former partners that round. Either may still win alone.
7. **Information:** troops and territory are public; cards, private scan reports and unrevealed combat commitments are private. Towers expose nearby enemy hand counts and enable a Scan operation to inspect a random card. Cards are the only hidden-information system; there are no hidden roles or secret objectives.
8. **Ending:** check Signal Attempts after all 18 actions. After eight rounds or the timer's expiry, finish the current round and check Signal first. If no decisive Signal victory, score two points per Broadcast Site and one per other district. Allied pairs combine scores minus three. Ineligible alliances cannot share a victory that round. Top tied contenders share the win.

Read the complete [RULES.md](RULES.md), or open **Field manual** in the game, for exact costs, faction abilities, card effects, retreat order and tie handling.

## Implemented

- Standard offline bots for 1–6 human players; bots use their own private view, resolve combat, accept sensible trades/alliances and pursue sites.
- Optional first-round guide with per-player Skip/Resume and saved progress; no forced actions or altered rules.
- Consistent typography, uncluttered two-column play layout, and help controls available by focus, hover or click.
- All six asymmetric factions, 19 connected districts, five Broadcast Sites, six protected hideouts.
- Alternating operations, rotating initiative, eight-round/time-limit endings and solo/shared victories.
- Graffiti ownership, propaganda influence, structure capture and tower surveillance.
- Private card hands and scan reports, sealed combat locks, deterministic battle resolution and automatic retreats.
- Consent-based alliances and trades, immediate betrayal costs, no elimination.
- Server validation, private state projection per seat, authoritative arrival order, revision checks, durable action receipts and saved-game recovery.
- Responsive CSS/SVG interface with map, resource counters, highlighted legal choices, operation reasons, expandable crew standings/activity/cards and searchable in-game rules. Focus and scroll positions survive updates. All visuals are original CSS/SVG. All browser scripts and Socket.IO assets are served locally.

## Verification and limits

Run rules/network/DOM checks after installing dev dependencies:

```powershell
npm.cmd ci
npm.cmd test
```

Tests exercise complete rounds/endings, every faction, combat/card interactions, hidden-state boundaries, trades/betrayals, and real six-client Socket.IO sessions including duplicate clicks, disconnects and disk restoration. DOM tests also cover focus/disclosure/pan preservation, live prices, trade validation, timeout retry identity, tutorial progression, help controls and end standings.

For real browser checks, install the test browser once, then run:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:browser
```

These are development tools only. They are not needed to host or join a game.

The revised screens were exercised in real Chromium at laptop (1366×900) and mobile (390×844) sizes: joining, full-lobby restoration, bot setup, tutorial, operations/map, combat, diplomacy, rules, reconnect and final standings. Sol, Terra and Luna independently reviewed the original and revised screens; see [the review notes](docs/review/README.md) for findings and fixes. Automated browser tests also verify no external gameplay requests and no body-width overflow.

A real six-person Windows/Wi-Fi session, human balance and 180–240 minute pacing remain unverified. The timer is an end trigger, not a minimum game length. Standard bots use deterministic heuristics with no extra information or difficulty selector; they are practice opponents rather than expert negotiators. They respond to alliance/resource offers but do not start negotiations or chat. All six faction abilities remain available to human players; bots use a simple subset of operations. A saved match supports one to six humans plus enough bots to keep six crews; no zero-human background simulation. There is one saved match per server process and no undo, chat or replay archive.

The host must be trusted: they run the authoritative server and can inspect its private save file. This is a local game, not a hosted anti-cheat service.

Suggested next edits after your first game: tune faction balance and income, improve bot diplomacy and faction-specific plans, and review the five-site layout.

## Project layout

- `server.js` — LAN server, lobby/host authentication, persistence, reconnects, request receipts and private broadcasts.
- `bots.js` — decisions from a crew’s filtered view; no remote AI/API calls.
- `engine.js` — transactional rule validation, operations, combat and victory checks.
- `public/shared.js` — public definitions and the in-game manual; no live private information.
- `public/app.js`, `public/style.css`, `public/index.html` — local browser interface.
- `test/` — rules, bot scheduling/recovery, network and DOM interaction tests.
- `browser-tests/` — real Chromium screen-flow checks at laptop and mobile sizes.
- `install.cmd`, `start-game.cmd` — Windows helpers.
