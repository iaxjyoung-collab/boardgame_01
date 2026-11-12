# Cold Static

An original six-player strategy game about graffiti, espionage and fragile alliances in a divided city. Built for six laptops on the same local Wi-Fi. The host runs a small Node.js server; everyone plays in a browser. No accounts, cloud services, external assets or internet requests during play.

## Windows: install once

Only the host computer needs Node.js or this folder. The other five laptops only need a modern browser.

1. Install **Node.js LTS** from <https://nodejs.org> before game night (Node 22 or 24 recommended; minimum Node 20). Use the standard Windows installer and its default options. Reopen your terminal after installation.
2. Extract the supplied **ColdStatic.zip** to a normal folder, for example `C:\Games\ColdStatic`. If using GitHub, **Code → Download ZIP** also works once the game files are uploaded there. Do not run the game from inside the ZIP.
3. Open that folder and double-click **install.cmd**. This downloads the locked server dependencies once. Wait for “Installation complete.” Internet is required only for this step and downloading Node/the game.

Alternatively, open PowerShell in the extracted game folder and run:

```powershell
npm.cmd ci --omit=dev
```

## Start and join on game night

1. Connect all six laptops to the same Wi-Fi. Use a normal home/private network; guest Wi-Fi may prevent laptops from talking to each other.
2. On the host, double-click **start-game.cmd**. Keep its terminal open for the whole game. The server binds to **0.0.0.0**, so it accepts local-network connections.
3. If Windows asks whether to allow Node.js through the firewall, allow it on **Private networks** for your home Wi-Fi. If you dismissed the prompt, use **Windows Security → Firewall & network protection → Allow an app through firewall → Change settings**, and enable the Private checkbox for Node.js JavaScript Runtime. Your Windows network profile should be Private for your trusted Wi-Fi.
4. On the host, open **http://localhost:3000**. Enter a callsign, then open **Are you hosting?** and enter the **host code printed in the terminal**. The code grants host controls and is not included in browser state.
5. The terminal and host lobby show one or more join addresses, such as **http://192.168.1.42:3000**. Other laptops open that address. Use the Wi-Fi address if VPN/virtual adapter addresses also appear. `localhost` works only on the host itself.
6. Each player enters a different callsign and picks an unclaimed faction. Factions are assigned automatically on joining, and can be changed to an available one. To exchange occupied factions, the host can remove disconnected seats in the lobby; rejoin in the desired order.
7. The host chooses **180, 210 (default), or 240 minutes**, then clicks **Start operation** once all six players are connected. All six seats are required; there are no bots or spectators.

To find the correct local address manually, open PowerShell, run `ipconfig`, and look under **Wireless LAN adapter Wi-Fi → IPv4 Address**, for example `192.168.1.42`. The join address is `http://` + that address + `:3000`.

If port 3000 is occupied, open PowerShell in the game folder and run:

```powershell
$env:PORT = '3001'
npm.cmd start
```

Then join at `http://<host-Wi-Fi-IPv4>:3001`. For the normal port, leave `PORT` unset. If a friend cannot connect, first check the same Wi-Fi, correct IPv4/port, Windows Private firewall permission, and guest-network/client-isolation settings. No router port forwarding is needed.

## Reconnect, save and restart

- Refreshing or losing Wi-Fi does not lose a seat. The browser stores a private reconnect token and automatically restores that player's hand and state. **Do not clear site storage during a match.** The same address and port preserve the browser's saved seat.
- **My seat token** lets a player privately copy their token. On another browser/device, open the host address, expand **Restore a seat**, and paste it. This also works if the host IP changes. Treat it as a password for that crew; keep it private.
- The server saves every successful mutation to **data/match.json** using an atomic file replacement, before acknowledging the action. Starting the server again from this same folder restores the match, pending combat locks, host control, reconnect tokens and timer. Time while the server is off still counts; finish the current round if the timer has elapsed.
- If a confirmation is lost, use **Retry last request**; the same request ID is reused. The server stores receipts and checks versions to prevent duplicate effects. A stale request fails with an explanation instead of acting on an outdated map.
- A disconnected active player pauses the turn. After 60 seconds, the host can use **Host controls → Pass disconnected turn**. Combat always waits for both players to return. A player may restore their token on another device.
- **Host controls → Reset to lobby** replaces the current match after confirmation. Seats and factions are retained; all gameplay progress is cleared. This is also how to start a second game.
- To back up a game, stop the server and copy `data/match.json` somewhere private. Restore it into the same folder with the server stopped. `data/` is excluded from Git and release bundles.

## Learn in 15 minutes

1. **The objective:** own three of the five starred Broadcast Sites at the end of a round. A formal pair needs four, with each holding at least one. Announce a free **Signal Attempt before your final action**; a pair must announce while both still have an action remaining.
2. **Your economy:** Supply pays for troops, tagging, construction and combat; Intel pays for new cards, scans and betrayal. You start with four operatives, six Supply, three Intel and two cards, then the first city event may add resources/cards. Each new round provides income. Both resources cap at 30.
3. **Your turn:** take one operation, then the next crew acts. Everyone takes three operations per round. Move, tag, recruit, build, spread, gather, explore, scan or pass. Select a district and an operation to see its cost and why it may be unavailable. The starting crew rotates each round.
4. **Control:** graffiti, not troops, marks ownership. Move into an empty district, then use a separate Tag operation to claim it. A mural can claim empty neighbouring districts through two influence markers. Captured structures transfer with ownership. Hideouts are permanent and protected, so nobody is eliminated.
5. **Conflict:** both fighters secretly commit 0–3 Supply and optionally a card. Strength is operatives + Supply + card effect; defender wins ties. Reveal together, spend the resources, discard the cards, and retreat the loser with one casualty. Attackers still need to Tag later. There are no combat dice.
6. **Pacts:** use Back channels to propose a two-person alliance or an immediate resource trade. Acceptance is required. Offers expire at the next operation. Pacts prevent hostile actions against each other. Betrayal costs two Intel, compensates the former partner with two Supply, and blocks **shared** victory for both former partners that round. Either may still win alone.
7. **Information:** troops and territory are public; cards, private scan reports and unrevealed combat commitments are private. Towers expose nearby enemy hand counts and enable a Scan operation to inspect a random card. Cards are the only hidden-information system; there are no hidden roles or secret objectives.
8. **Ending:** check Signal Attempts after all 18 actions. After eight rounds or the timer's expiry, finish the current round and check Signal first. If no decisive Signal victory, score two points per Broadcast Site and one per other district. Allied pairs combine scores minus three. Ineligible alliances cannot share a victory that round. Top tied contenders share the win.

Read the complete [RULES.md](RULES.md), or open **Field manual** in the game, for exact costs, faction abilities, card effects, retreat order and tie handling.

## Implemented

- All six asymmetric factions, 19 connected districts, five Broadcast Sites, six protected hideouts.
- Alternating operations, rotating initiative, eight-round/time-limit endings and solo/shared victories.
- Graffiti ownership, propaganda influence, structure capture and tower surveillance.
- Private card hands and scan reports, sealed combat locks, deterministic battle resolution and automatic retreats.
- Consent-based alliances and trades, immediate betrayal costs, no elimination.
- Server validation, private state projection per seat, authoritative arrival order, revision checks, durable action receipts and saved-game recovery.
- Responsive CSS/SVG interface with map, roster, resource counters, operation reasons, public log, private dossiers and in-game manual. All visuals are original CSS/SVG. All browser scripts and Socket.IO assets are served locally.

## Verification and limits

Run developer checks after installing dev dependencies:

```powershell
npm.cmd ci
npm.cmd test
```

Tests exercise complete rounds/endings, every faction, combat/card interactions, hidden-state boundaries, trades/betrayals, and real six-client Socket.IO sessions including duplicate clicks, disconnects and disk restoration. DOM interaction tests cover map controls, operation requests, private combat controls and input preservation.

The managed build environment did not expose its required browser-preview control, so **visual browser QA and a six-person Windows/Wi-Fi session remain unverified**. Automated DOM tests do not replace those checks. Game balance and the 180–240 minute pacing need a human playtest; the timer is a ceiling trigger, not a guarantee the game lasts that long. This release supports one saved match per host process, exactly six human players and modern browsers. Host controls cannot substitute for a missing combatant. There is no undo, chat, bot AI, replay archive or printed rules export beyond the included Markdown manual. Negotiation happens in the room.

The host must be trusted: they run the authoritative server and can inspect its private save file. This is a local game, not a hosted anti-cheat service.

Suggested next edits after your first game: tune faction balance and income, review the five-site layout, then add optional starting-position drafting or a shorter teaching scenario.

## Project layout

- `server.js` — LAN server, lobby/host authentication, persistence, reconnects, request receipts and private broadcasts.
- `engine.js` — transactional rule validation, operations, combat and victory checks.
- `public/shared.js` — public definitions and the in-game manual; no live private information.
- `public/app.js`, `public/style.css`, `public/index.html` — local browser interface.
- `test/` — rules, network and DOM interaction tests.
- `install.cmd`, `start-game.cmd` — Windows helpers.
