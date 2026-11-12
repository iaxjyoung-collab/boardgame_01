const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const E = require("../engine"),
  { createGameServer } = require("../server");
function lobby() {
  const s = E.initial();
  s.hostCode = "TESTHOST";
  s.hostId = "p0";
  s.players = Array.from({ length: 6 }, (_, i) => ({
    id: "p" + i,
    token: "test-token-" + i,
    name: ["Alex", "Blair", "Casey", "Drew", "Ellis", "Fin"][i],
    faction: i,
  }));
  return s;
}
function playing() {
  const s = lobby();
  E.start(s, Date.now());
  return s;
}
async function visit(browser, state, fn, { seat = true, viewport } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cold-static-browser-"));
  fs.writeFileSync(path.join(dir, "match.json"), JSON.stringify(state));
  const game = createGameServer({ dataDir: dir, port: 0, botDelayMs: 300 });
  await new Promise((r) => game.server.listen(0, "127.0.0.1", r));
  const context = await browser.newContext({
      viewport: viewport || { width: 1366, height: 900 },
    }),
    errors = [],
    external = [];
  if (seat)
    await context.addInitScript(() =>
      localStorage.setItem("cold-static-seat", "test-token-0"),
    );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => {
    if (!new URL(req.url()).hostname.startsWith("127.0.0.1"))
      external.push(req.url());
  });
  try {
    await page.goto(`http://127.0.0.1:${game.server.address().port}`);
    await expect(page.locator("#main")).toBeVisible();
    if (seat) await expect(page.locator("#open-seat")).toBeVisible();
    await fn({ page, context, game });
    expect(await page.locator("body").textContent()).not.toContain("${");
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
    await game.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function shot(page, testInfo, label) {
  await page.screenshot({
    path: testInfo.outputPath(label + ".png"),
    fullPage: true,
  });
}
test("join, full lobby restore, mobile setup and focus/click help", async ({
  browser,
}, info) => {
  const empty = lobby();
  empty.players = [];
  delete empty.hostId;
  await visit(
    browser,
    empty,
    async ({ page }) => {
      await expect(page.locator("#callsign")).toBeVisible();
      await page.locator('[data-help="sites"]').focus();
      await expect(page.locator("#guide-tip")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("#guide-tip")).toBeHidden();
      await page.locator('[data-help="sites"]').hover();
      await page.locator("#guide-tip").hover();
      await page.waitForTimeout(250);
      await expect(page.locator("#guide-tip")).toBeVisible();
      await page.keyboard.press("Escape");
      await shot(page, info, "join");
    },
    { seat: false, viewport: { width: 390, height: 844 } },
  );
  await visit(
    browser,
    lobby(),
    async ({ page }) => {
      await expect(page.locator("#callsign")).toHaveCount(0);
      await expect(page.locator("#restore-token")).toBeVisible();
      await shot(page, info, "full-restore");
    },
    { seat: false },
  );
  const setup = lobby();
  setup.players = setup.players.slice(0, 1);
  setup.tutorialEnabled = true;
  await visit(
    browser,
    setup,
    async ({ page }) => {
      await expect(page.locator("#fill-bots")).toBeEnabled();
      await page.locator("#tutorial-enabled").uncheck();
      await expect.poll(() => gameTutorial(page)).toBe(false);
      await shot(page, info, "lobby-mobile");
    },
    { viewport: { width: 390, height: 844 } },
  );
});
async function gameTutorial(page) {
  return page.locator("#tutorial-enabled").isChecked();
}
test("laptop map, legal moves, live recruitment cost and stable keyboard focus", async ({
  browser,
}, info) => {
  await visit(browser, playing(), async ({ page }) => {
    await expect(page.locator(".map-node")).toHaveCount(19);
    await expect(
      page.locator('[data-persist="crew-list"]'),
    ).not.toHaveAttribute("open");
    await page.locator("#tool-move").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#tool-move")).toBeFocused();
    await expect(page.locator("#to option")).toHaveCount(4);
    await page.locator("#district-1").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#district-1")).toBeFocused();
    await expect(page.locator("#to")).toHaveValue("1");
    await expect(page.locator("#execute")).toBeEnabled();
    await page.locator('[data-persist="more-actions"] summary').click();
    await page.locator("#tool-recruit").click();
    await page.locator("#district-7").click();
    await page.locator("#recruitCount").fill("3");
    await expect(page.locator("#operation-cost")).toContainText("3 Supply");
    await shot(page, info, "game-laptop");
    const sizes = await page
      .locator("body,button,input,select")
      .evaluateAll((els) => [
        ...new Set(
          els
            .filter((el) => el.getClientRects().length)
            .map((el) => getComputedStyle(el).fontFamily),
        ),
      ]);
    expect(sizes.length).toBe(1);
  });
});
test("tutorial saves, skips, resumes, follows accepted actions and ends after round one", async ({
  browser,
}, info) => {
  const s = playing();
  s.tutorialEnabled = true;
  await visit(browser, s, async ({ page }) => {
    await expect(page.locator(".tutorial")).toContainText("1 of 5");
    await page.locator("#guide-next").click();
    await page.locator("#guide-next").click();
    await expect(page.locator(".tutorial")).toContainText("3 of 5");
    await page.reload();
    await expect(page.locator(".tutorial")).toContainText("3 of 5");
    await page.locator("#skip-guide").click();
    await expect(page.locator(".tutorial")).toHaveCount(0);
    await page.locator("#open-guide").click();
    await expect(page.locator(".tutorial")).toContainText("3 of 5");
    await page.locator("#guide-gather").click();
    await page.locator("#execute").click();
    await expect(page.locator(".tutorial")).toContainText("4 of 5");
    await expect(page.locator("#guide-tag")).toHaveText("Plan Tag");
    await page.locator("#guide-tag").click();
    await expect(page.locator("#why")).not.toContainText(
      "Your operatives must be here",
    );
    await shot(page, info, "tutorial");
  });
});
test("combat locks validate input, explain strength and keep the conflict visible", async ({
  browser,
}, info) => {
  let s = playing();
  s.nodes[1].units.p0 = 3;
  s.nodes[0].units.p1 = 3;
  s.nodes[0].owner = "p1";
  s = E.apply(s, "p0", { type: "move", from: 1, to: 0, count: 3 });
  await visit(browser, s, async ({ page }) => {
    await expect(page.locator("#execute")).toHaveCount(0);
    await expect(page.locator("#district-0")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator("#supply").fill("1.5");
    await expect(page.locator("#lock-commitment")).toBeDisabled();
    await page.locator("#supply").fill("2");
    await expect(page.locator("#combat-strength")).toContainText(
      "3 + 2 + 0 = 5",
    );
    await page.locator('[data-help="commitment"]').click();
    await expect(page.locator("#guide-tip")).toBeVisible();
    const tipBox = await page.locator("#guide-tip").boundingBox(),
      rowBox = await page.locator(".battle-crew").first().boundingBox();
    expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(rowBox.y);
    await shot(page, info, "combat-help");
    await page.keyboard.press("Escape");
    await expect(page.locator("#guide-tip")).toBeHidden();
    await shot(page, info, "combat");
    await page.locator("#lock-commitment").click();
    await expect(page.locator(".locked")).toContainText("Your lock: 2 Supply");
  });
});
test("diplomacy offers, trade previews, searchable rules and reconnect copy controls", async ({
  browser,
}, info) => {
  let s = playing();
  s = E.apply(s, "p1", { type: "offer", kind: "pact", target: "p0" });
  await visit(browser, s, async ({ page }) => {
    await expect(page.locator("#open-diplomacy .count")).toHaveText("1");
    await expect(page.locator("#review-offers")).toBeVisible();
    await page.locator("#open-diplomacy").click();
    await expect(page.locator("#diplomacy")).toBeVisible();
    await page.locator("#dipTarget").selectOption("p2");
    await page.locator("#kind").selectOption("trade");
    await page.locator("#giveSupply").fill("2");
    await expect(page.locator("#trade-preview")).toContainText(
      "You pay 2 Supply",
    );
    await page.locator("#giveSupply").focus();
    await page.waitForTimeout(150);
    await expect(page.locator("#giveSupply")).toBeFocused();
    const footer = await page.locator("#send-offer").boundingBox();
    expect(footer.y + footer.height).toBeLessThan(900);
    await shot(page, info, "diplomacy");
    await page.locator("#diplomacy [data-close]").click();
    await page.locator("#open-rules").click();
    await page.locator("#rule-search").fill("Counterfrequency");
    await expect(page.locator("#rule-section-3")).toBeVisible();
    await shot(page, info, "rules");
    await page.locator("#rules [data-close]").click();
    await page.locator("#open-seat").click();
    await expect(page.locator("#seat-token")).toHaveValue("test-token-0");
    await expect(page.locator('[data-do="copy-token"]')).toBeVisible();
    await shot(page, info, "reconnect");
  });
});
test("finished screen explains shared victory with standings and has no action form", async ({
  browser,
}, info) => {
  let s = playing();
  for (let i = 0; i < 18; i++)
    s = E.apply(s, s.players[s.turn].id, { type: "pass" }, s.endsAt + 1);
  await visit(browser, s, async ({ page }) => {
    await expect(page.locator(".ending")).toContainText(
      "6 contenders share victory",
    );
    await expect(page.locator("tbody tr")).toHaveCount(6);
    await expect(page.locator("#ending-reset")).toBeVisible();
    await expect(page.locator("#execute")).toHaveCount(0);
    await shot(page, info, "ending");
  });
});
test("one human can add five bots and play a guided opening through the real lobby", async ({
  browser,
}, info) => {
  const s = lobby();
  s.players = [];
  delete s.hostId;
  await visit(
    browser,
    s,
    async ({ page, game }) => {
      await page.locator("#callsign").fill("Solo");
      await page.locator("#join-form button").click();
      await page.locator('[data-persist="host-claim"] summary').click();
      await page.locator("#host-code").fill("TESTHOST");
      await page.locator("#host-form button").click();
      await page.locator("#fill-bots").click();
      await expect(page.locator(".seat-row")).toHaveCount(6);
      await expect(page.locator("#start-game")).toBeEnabled();
      await page.locator("#tutorial-enabled").check();
      await shot(page, info, "bot-lobby");
      await page.locator("#start-game").click();
      await expect(page.locator(".tutorial")).toBeVisible();
      await expect(page.locator(".turn-bar h1")).toHaveText("Your turn");
      await page.locator("#execute").click();
      await expect.poll(() => game.getState().players[0].actions).toBe(2);
      await expect.poll(() => game.getState().turn, { timeout: 8000 }).toBe(0);
      await expect(page.locator(".turn-bar h1")).toHaveText("Your turn");
      await shot(page, info, "bot-game");
    },
    { seat: false },
  );
});
test("mobile game and mobile combat keep actionable controls reachable without body overflow", async ({
  browser,
}, info) => {
  await visit(
    browser,
    playing(),
    async ({ page }) => {
      await page.locator("#tool-move").click();
      await page.locator("#to").selectOption("1");
      await expect(page.locator("#execute")).toBeEnabled();
      await expect(page.locator(".pan-hint")).toBeVisible();
      await page.locator("#review-operation").click();
      await expect(page.locator(".action-panel h2")).toBeInViewport();
      await shot(page, info, "game-mobile");
    },
    { viewport: { width: 390, height: 844 } },
  );
  let s = playing();
  s.nodes[1].units.p0 = 2;
  s.nodes[0].units.p1 = 2;
  s = E.apply(s, "p0", { type: "move", from: 1, to: 0, count: 2 });
  await visit(
    browser,
    s,
    async ({ page }) => {
      const battleTop = await page
        .locator(".battle-box")
        .evaluate((el) => el.getBoundingClientRect().top);
      const mapTop = await page
        .locator(".map-panel")
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(battleTop).toBeLessThan(mapTop);
      await page.locator("#supply").fill("1");
      await expect(page.locator("#lock-commitment")).toBeEnabled();
      await shot(page, info, "combat-mobile");
    },
    { viewport: { width: 390, height: 844 } },
  );
});

test("tag tutorial plans a move first when the faction has no legal tag", async ({
  browser,
}, info) => {
  const s = playing();
  s.tutorialEnabled = true;
  s.players[0].faction = 1;
  s.players[1].faction = 0;
  await visit(browser, s, async ({ page }) => {
    await page.evaluate(
      ({ endsAt }) =>
        localStorage.setItem(
          `cold-static-guide:${endsAt}:p0`,
          JSON.stringify({ step: 3, dismissed: false }),
        ),
      { endsAt: s.endsAt },
    );
    await page.reload();
    await expect(page.locator("#guide-tag")).toHaveText("Plan a move first");
    await page.locator("#guide-tag").click();
    await expect(page.locator("#tool-move")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#execute")).toBeEnabled();
  });
});
