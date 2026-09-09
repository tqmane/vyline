import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect, type Locator } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5186";
const output = `test-results/native-header-menu/${Date.now()}`;
await mkdir(output, { recursive: true }); console.log(`Artifacts: ${output}`);
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["fluent", "miuix", "apple"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { ok: true, items: [], results: [], profiles: {} } });
      return route.continue();
    });
    await page.addInitScript(mode => {
      localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 }));
      (window as any).menuActions = [];
      addEventListener("message", event => {
        let data = event.data; if (typeof data === "string") { try { data = JSON.parse(data); } catch { return; } }
        if (data?.type === "action" && data.action === "chat-menu") (window as any).menuActions.push(data);
      });
    }, mode);
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
      const click = async (locator: Locator) => {
        await expect(locator).toBeAttached(); await page.waitForTimeout(1300);
        const box = await locator.boundingBox(); assert(box && box.width > 0 && box.height > 0);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); return box;
      };
      for (const variant of ["wide", "offset-split", "narrow"]) {
        if (variant === "offset-split") await page.evaluate(async () => {
          const shell = document.querySelector<HTMLElement>(".pr-demo-shell")!;
          Object.assign(shell.style, { width: "calc(100% - 100px)", marginLeft: "80px", height: "calc(100% - 50px)", marginTop: "30px" });
          const path = performance.getEntriesByType("resource").map(entry => entry.name).findLast(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!;
          const { useStore } = await import(path); const state = useStore.getState();
          const ids = state.chats.slice(0, 2).map((chat: { id: string }) => chat.id);
          useStore.setState({ chatPaneIds: ids, chatPaneSizes: [50, 50], focusedChatPane: 1, activeChatId: ids[1] });
        });
        if (variant === "narrow") { await page.reload(); await page.setViewportSize({ width: 390, height: 844 }); await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 }); }
        await page.waitForTimeout(1500);
        const currentFrame = page.frames().find(frame => frame.url().includes("ui-compose"))!;
        const control = currentFrame.getByRole("button", { name: mode === "apple" ? "添付とその他の操作" : "トークの操作", exact: true }).last();
        await page.evaluate(() => { (window as any).menuActions = []; });
        const origin = await page.locator('iframe[title="Vyline Compose UI"]').boundingBox(); assert(origin);
        const anchor = await click(control);
        if (mode === "apple") await click(currentFrame.getByRole("button", { name: "トークの操作", exact: true }));
        await expect.poll(() => page.evaluate(() => (window as any).menuActions.length)).toBe(1);
        const action = await page.evaluate(() => (window as any).menuActions[0]);
        assert(Math.abs(action.x - (anchor.x + anchor.width / 2 - origin.x)) < 2, `${mode}/${variant} x anchor`);
        assert(Math.abs(action.y - ((mode === "apple" ? anchor.y : anchor.y + anchor.height) - origin.y)) < 2, `${mode}/${variant} y anchor`);
        const menu = currentFrame.getByRole("button", { name: "メッセージを検索", exact: true });
        await expect(menu).toBeAttached(); await page.waitForTimeout(1300);
        const box = await menu.boundingBox(); assert(box);
        assert(box.x >= origin.x && box.x + box.width <= origin.x + origin.width + 1 && box.y >= origin.y, "menu remains inside its host");
        if (mode === "fluent" && variant !== "narrow") assert(box.x > origin.x + origin.width / 2, "right-hand header menu stays on the right");
        await page.screenshot({ path: `${output}/${mode}-${variant}.png` });
        await page.keyboard.press("Escape"); await expect(menu).toHaveCount(0);
        if (variant === "narrow") {
          await click(currentFrame.getByRole("button", { name: "トーク一覧に戻る", exact: true }));
          const search = currentFrame.getByRole("textbox", { name: "トークを検索", exact: true });
          await click(search); await page.keyboard.insertText("開発");
          await expect(search).toContainText("開発");
          await click(currentFrame.getByRole("button", { name: "検索をクリア", exact: true }));
          await expect(currentFrame.getByRole("button", { name: "検索をクリア", exact: true })).toHaveCount(0);
          await page.screenshot({ path: `${output}/${mode}-search.png` });
        }
        console.log(`${mode}/${variant}: measured anchor and menu bounds passed`);
      }
    } catch (error) { await page.screenshot({ path: `${output}/${mode}-failure.png` }); throw error; }
    finally { await page.close(); }
  }
} finally { await browser.close(); }
