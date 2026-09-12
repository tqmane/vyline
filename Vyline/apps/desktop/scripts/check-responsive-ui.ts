import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = new URL(process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173");
assert(["127.0.0.1", "localhost"].includes(base.hostname), "Use a local demo server");
const output = resolve(import.meta.dir, process.env.VYLINE_TEST_OUTPUT ?? `../test-results/responsive-ui/${Date.now()}`);
await mkdir(output, { recursive: true });
console.log(`Artifacts: ${output}`);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
const failures: string[] = [];
const reactionLabels = ["いいね", "ハート", "笑い", "驚き", "悲しい", "びっくり"];

async function point(page: Page, locator: Locator) {
  await expect(locator).toBeAttached();
  let previous = "";
  let stable = 0;
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const next = JSON.stringify(box);
    stable = box && next === previous ? stable + 1 : 0;
    previous = next;
    const viewport = page.viewportSize()!;
    return stable >= 3 && !!box && box.width > 0 && box.height > 0 &&
      box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  }, { intervals: [100] }).toBe(true);
  const box = (await locator.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["legacy", "nezu", "apple", "fluent", "miuix"]) {
    for (const appearance of ["light", "dark"]) {
      const name = `${mode}-${appearance}`;
      const compose = ["apple", "fluent", "miuix"].includes(mode);
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      // The account-free demo must be self-contained. Any API or non-local request
      // indicates that screenshot verification no longer represents the offline UI.
      await page.route("**/*", route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== base.origin || url.pathname.startsWith("/api/")) return route.abort();
        return route.continue();
      });
      await page.addInitScript(preferences => localStorage.setItem("vyline:design-system", JSON.stringify({ state: preferences, version: 0 })), { mode, appearance });
      const capture = async (scene: string) => {
        await page.waitForTimeout(650);
        await page.screenshot({ path: resolve(output, `${name}-${scene}.png`) });
      };
      try {
        await page.goto(`${base.origin}/pr-demo`, { waitUntil: "domcontentloaded" });
        if (compose) await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
        else {
          await expect(page.locator("textarea").first()).toBeVisible();
          // Classic/Nezu use VyTheme, not the Compose appearance preference.
          await page.evaluate(async appearance => {
            const path = performance.getEntriesByType("resource").map(entry => entry.name)
              .findLast(url => new URL(url).pathname === "/src/lib/store.ts");
            if (!path || location.pathname !== "/pr-demo") throw new Error("Loaded demo store required");
            const { useStore, THEME_PRESETS } = await import(path);
            if (!useStore.getState().demoMode || useStore.getState().accountId !== null) throw new Error("Account-free demo required");
            const theme = THEME_PRESETS.find((theme: { id: string }) => theme.id === (appearance === "dark" ? "line-dark" : "soft-day"));
            if (!theme) throw new Error("Built-in theme fixture missing");
            useStore.getState().setTheme(theme);
          }, appearance);
        }
        for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
          await page.setViewportSize(viewport);
          await capture(`chat-${viewport.width}`);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Page must not overflow horizontally");
          if (compose && mode === "apple" && viewport.width <= 390) {
            const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
            const header = native.getByRole("button", { name: "Vyline開発チームの情報", exact: true });
            const timeline = native.getByRole("list", { name: "メッセージ履歴", exact: true });
            await expect(header).toBeAttached();
            await expect(timeline).toBeAttached();
            const headerBox = await header.boundingBox();
            const timelineBox = await timeline.boundingBox();
            assert(
              headerBox && timelineBox && timelineBox.y >= headerBox.y + headerBox.height,
              `Compact Apple header overlaps the message timeline: ${JSON.stringify({ headerBox, timelineBox })}`,
            );
          }
          if (compose && mode !== "apple" && viewport.width === 320) {
            const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
            const title = await (mode === "fluent"
              ? native.getByRole("button", { name: "Vyline開発チームの情報", exact: true })
              : native.getByText("Vyline開発チーム", { exact: true }).last()).boundingBox();
            assert(title && title.width >= 80, "Compact chat header must leave room for the conversation title");
            await point(page, native.getByRole("button", { name: "添付とその他の操作", exact: true }));
            await expect(native.getByRole("button", { name: "トーク内を検索", exact: true })).toBeAttached();
            await page.keyboard.press("Escape");
            await expect(native.getByRole("button", { name: "写真・動画", exact: true })).toHaveCount(0);
          }
        }
        if (compose) {
          const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
          // Feed a realistic six-type reaction list through the real store/projector.
          // No Kotlin state injection, account mutation or send action is involved.
          await page.evaluate(async () => {
            const path = performance.getEntriesByType("resource").map(entry => entry.name)
              .findLast(url => new URL(url).pathname === "/src/lib/store.ts");
            assertDemoPath();
            if (!path) throw new Error("Loaded Vite store required");
            const { useStore } = await import(path);
            const state = useStore.getState();
            if (!state.demoMode || state.accountId !== null) throw new Error("Account-free demo required");
            useStore.setState({ messages: [{ id: "responsive-reactions", chatId: state.activeChatId, authorId: "me",
              kind: "text", text: "リアクションの折り返し", createdAt: Date.now(), status: "sent", read: false,
              messageState: "normal", reactions: Array.from({ length: 60 }, (_, index) => ({
                fromMid: `fixture-reader-${index}`, type: 2 + Math.floor(index / 10),
              })) }] });
            function assertDemoPath() { if (location.pathname !== "/pr-demo") throw new Error("Demo route required"); }
          });
          await expect(native.getByRole("button", { name: "いいね 10件", exact: true })).toBeAttached();
          await capture("reactions-320");
          const boxes = await Promise.all(reactionLabels.map(label => native.getByRole("button", { name: `${label} 10件`, exact: true }).boundingBox()));
          boxes.forEach((box, index) => {
            if (!box || box.width < 32 || box.height < 18 || box.x < 0 || box.x + box.width > 321) {
              failures.push(`${name}: reaction ${reactionLabels[index]} clipped: ${JSON.stringify(box)}`);
            }
          });
          // Open the real settings panel using pointer input and inspect its narrow navigation.
          if (mode === "apple") {
            await point(page, native.getByRole("button", { name: "添付とその他の操作", exact: true }));
            const settings = native.getByRole("button", { name: "設定", exact: true }).last();
            await expect(settings).toBeAttached();
            const box = await settings.boundingBox();
            if (box && box.y + box.height > 640) {
              await page.mouse.move(160, 400); await page.mouse.wheel(0, 500);
            }
            await point(page, settings);
          } else await point(page, native.getByRole("button", { name: "設定", exact: true }).last());
          await point(page, native.getByRole("tab", { name: "既読", exact: true }));
          await capture("settings-320");
          const control = native.getByRole("switch", { name: "既読を送る", exact: true });
          const before = await control.boundingBox();
          assert(before && before.width >= 32);
          const navigationName = mode === "fluent" ? "設定ナビゲーション" : "設定サイドバーを開く";
          // Fluent's collapsing container also inherits the child's accessible name.
          // Address the actual hamburger button, never that enclosing rail.
          const navigationButton = () => native.getByRole("button", { name: navigationName, exact: true }).last();
          await point(page, navigationButton());
          await capture("settings-expanded-320");
          if (mode !== "fluent") await expect(control).toHaveCount(0);
          // Escape first dismisses the overlay, keeping the selected settings open.
          await page.keyboard.press("Escape");
          await expect(control).toBeAttached();
          await expect.poll(async () => (await control.boundingBox())?.width ?? 0).toBe(before.width);
          await point(page, navigationButton());
          // The native rail animates item heights as well as its width. Verify
          // category selection after the expansion, with its final hit regions.
          await capture("settings-reopened-320");
          await point(page, native.getByRole("tab", { name: "表示", exact: true }));
          await expect(native.getByRole("tab", { name: "表示", exact: true })).toHaveAttribute("aria-selected", "true");
          if (mode !== "fluent") await expect(native.getByRole("button", { name: "設定サイドバーを開く", exact: true })).toBeAttached();
          results.push({ mode, appearance, reactionBounds: boxes, screenshots: 8, errors });
        } else results.push({ mode, appearance, screenshots: 4, errors });
        assert.deepEqual(errors, [], "No browser runtime errors");
        console.log(`${name}: captured and inspected responsive controls`);
      } catch (error) {
        failures.push(`${name}: ${String(error)}; browser errors: ${JSON.stringify(errors)}`);
        console.error(`${name}: ${String(error)}`);
        await capture("failure").catch(() => undefined);
        if (compose) await writeFile(resolve(output, `${name}-failure.txt`), await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot().catch(() => "Unavailable"));
      } finally { await page.close(); }
    }
  }
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ results, failures,
    scope: "Account-free demo; 320/390/768/1440 CSS pixels; light/dark; reaction artwork is served from local /demo assets; screenshots need visual review." }, null, 2));
  await browser.close();
}
console.log({ cases: results.length, failures });
assert.deepEqual(failures, []);
