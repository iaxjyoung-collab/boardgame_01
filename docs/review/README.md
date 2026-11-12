# UI review and validation — Cold Static 1.1

The user requested independent Sol, Terra and Luna critiques, fixes, bots, a guided first round, less visual noise, consistent typography and contextual help.

## Review coverage

Three independent reviewers were explicitly run: **Sol (gpt-6.1-sol)**, **Terra (gpt-6.1-terra)** and **Luna (gpt-6-luna)**. They reviewed the original screen implementation and before/after browser captures. All three inspected the 14 revised captures spanning join, full-room restore, mobile setup, bot lobby, laptop/mobile map, bot game, tutorial, laptop/mobile combat, diplomacy, searchable rules, reconnect and ending. Terra also implemented and tested the server-side bots/recovery. Sol added UI regression tests. The primary agent implemented the UI and ran Chromium screen flows.

Their initial assessment: the theme was clear, but the lobby behaved like a poster, the map required trial-and-error, the roster and rule text competed with the current task, and recovery/irreversible choices lacked enough guidance. Final visual reviews also caught a final-board template interpolation error, combat annotation overlap, a tutorial action that could be unusable, mobile navigation friction and a hidden diplomacy send action. Those findings were fixed before release. All three reviewers then spot-checked the corrected screens and reported no remaining blocker-level issue.

## Criticisms and fixes

| Finding                                                                           | Change                                                                                                                                                                                                         | Validation                                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Six humans required; bots could deadlock combat or leak hidden choices            | Host can add/fill/remove standard bot seats. Bots act from their own filtered view, use the same engine, wait for private commitments and resume saved games.                                                  | Bot unit/network/restart tests; real solo + five-bot browser flow.                     |
| Missing player can stall combat indefinitely                                      | After 60 seconds the host may assign temporary bot control. Rejoining with the original token restores human control and preserves any locked commitment. Countdown updates live.                              | Takeover/reconnect and locked-combat tests.                                            |
| Nine equal-weight verbs and no first action                                       | Move/Tag/Gather are primary; other operations expand on demand. Optional first-round guidance gives context, plans legal actions and follows accepted operations.                                              | Guide skip/resume/refresh, accepted action and battle-interruption tests.              |
| Tutorial could say “after moving” following Gather, or miss Underprint remote Tag | Tag lesson adapts to actual legal targets, includes remote Tag, and plans Move first when no Tag is possible.                                                                                                  | Browser tutorial flow; legal action projection.                                        |
| Illegal map options revealed only through errors                                  | Origins contain the player's groups; destinations are legal, with hostile and Courier-route labels. Map highlights available districts and draws the route.                                                    | DOM action requests, browser keyboard selection and legal destinations.                |
| Focus, draft, pan and disclosure state lost during live updates                   | Stable control identities; restore focus after dialogs render; preserve text selections, disclosure state and map/log/dialog scroll.                                                                           | DOM focus/disclosure/pan tests; actual Chromium focus checks.                          |
| Recruit price stale and quantity shared with movement                             | Separate quantities; live cost, legality and strength calculations update while typing.                                                                                                                        | Live-price and independent-quantity regression tests.                                  |
| Timed-out requests could be replaced                                              | Pending requests block further mutations. Retry preserves the exact request ID and payload; a persistent banner names the pending operation.                                                                   | Timeout/retry identity test plus server exactly-once tests.                            |
| Combat irreversible without enough explanation                                    | Role, visible units, strength equation, card effect, tie advantage and spending consequences stay visible. Invalid Supply disables Lock.                                                                       | Private-state tests; fractional-input and live-strength DOM/browser checks.            |
| Conflict map showed home, hid attacker, and overlapped labels                     | New combat selects its district, marks the contested node, draws attack route and labels the attacking force closer to the node.                                                                               | Browser combat selection; final screenshots.                                           |
| Incoming offers were silent; trades hard to evaluate                              | Incoming badge and banner; explicit expiry; viewer-relative payment/receipt/final-balance preview; local validity reasons. Bots leave a bounded human response window.                                         | Offer/trade tests and browser dialog flow.                                             |
| Send action could disappear below a modal's fold                                  | Diplomacy offers scroll separately; send button and reason remain in a fixed dialog footer.                                                                                                                    | Browser assertion that the send action remains in the viewport.                        |
| Large roster, textures, stamps, pips, pills and tiny text competed                | Removed screen texture and decorative grid/illustration. Two-column map/action layout. Crew standings, activity, cards and abilities are expandable.                                                           | Laptop/mobile screenshot review by all three agents.                                   |
| Mixed type styles and small critical controls                                     | One system sans-serif family. 16px body/controls; 14px secondary text; 20px section headings; 28px page headings. No uppercase monospace interface labels.                                                     | CSS tokens; browser computed-family check.                                             |
| Map codes lacked explanation/accessibility                                        | One attached site badge; Map key and textual district list. Full accessible names include owner, unit crew/count, structure, influence and neighbours.                                                         | 19 keyboard map controls; browser keyboard checks; screenshots.                        |
| Mobile map cropped without explanation and controls too far away                  | Explicit sideways-scroll hint and Fit city control; Review operation jump. Battle controls appear before the mobile map.                                                                                       | No body overflow; mobile jump and combat ordering browser assertions.                  |
| Help unavailable except hover; popup hid combat or vanished under pointer         | Contextual help opens on hover, focus or click; Escape/outside/repeat click dismiss. Popup can be hovered. Combat help expands inline above status rows. Essential costs/reasons remain visible.               | Keyboard/click dismissal tests and final combat capture.                               |
| Rules wall of prose and misleading privacy wording                                | Quick basics, search, section navigation and expandable paragraphs/action entries. Private cards, reports, offers and locks are described accurately.                                                          | Browser rules search/navigation; shared-rule review.                                   |
| Join flow mixed connectivity and restored crew state                              | Clear connected/restoring/error states; full rooms are restore-only with the form forced open. Saved-token clearing explains that it does not free a seat.                                                     | Full-room browser and DOM regressions.                                                 |
| Reconnect token and join addresses lacked copy controls                           | Copy reconnect token with feedback/fallback; copy per join address and Wi-Fi/virtual-adapter explanation.                                                                                                      | Browser reconnect screen; clipboard fallback in client.                                |
| End screen unclear, unsorted and still actionable                                 | Explicit shared-win message, personal outcome, ranked semantic table, sites/districts/alliance deduction and visible Return to lobby. Ended board is inspection-only. Distinct eight-round/time-limit reasons. | Ending DOM/browser tests; no template expressions visible across every browser screen. |

Release validation: **51 rules/bot/network/DOM tests and 9 real Chromium screen-flow tests passed**.

## Test commands

```text
npm test
npm run test:browser
```

The browser suite runs real Chromium at 1366×900 and 390×844, records the reviewed screens, rejects unexpected external requests, and checks that the page body does not overflow horizontally. Tests use isolated save directories; no real match or reconnect token is used in the captures.

This release still needs human balance/playtime testing and a real Windows home-Wi-Fi session. Standard bots use straightforward heuristics and a subset of operations; they are not expert negotiators. A panning mobile map preserves readable district labels; Fit city is available for an overview.

## Revised screen examples

The included captures use test players and dummy reconnect credentials.

- [Bot setup](bot-lobby.png)
- [Laptop game](game-laptop.png)
- [First-round guide](tutorial.png)
- [Combat](combat.png)
- [Diplomacy](diplomacy.png)
- [End screen](ending.png)
