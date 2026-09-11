import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = "http://127.0.0.1:5186";
const output = resolve(import.meta.dir, "../test-results/owned-reactions");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function press(page: Page, locator: Locator, hold = false) {
  await expect(locator).toBeAttached();
  await page.waitForTimeout(350);
  const bounds = await locator.boundingBox(); assert(bounds);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); if (hold) await page.waitForTimeout(700); await page.mouse.up();
}
try {
  for (const mode of ["legacy", "apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 980, height: 960 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return (url.origin !== base && url.origin !== "https://stickershop.line-scdn.net") || url.pathname.startsWith("/api/") ? route.abort() : route.continue();
    });
    await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 })), mode);
    try {
      await page.goto(`${base}/pr-demo`);
      if (mode !== "legacy") await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 90_000 });
      else await expect(page.getByText("これは撮影用の仮メッセージです。実アカウントとは接続していません。", { exact: true })).toBeVisible();
      await page.evaluate(async () => {
        const path = performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
        const { useStore } = await import(path!); const state = useStore.getState();
        assertDemo(state);
        function assertDemo(state: { demoMode: boolean; accountId: string | null }) { if (!state.demoMode || state.accountId !== null) throw new Error("Demo only"); }
        useStore.setState({ messages: [{ id: "owned-emoji-test", chatId: state.activeChatId, authorId: "me", kind: "text", text: "絵文字リアクションの確認", createdAt: Date.now(), status: "sent", read: false, messageState: "normal" }] });
      });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      if (mode === "legacy") {
        await page.getByText("絵文字リアクションの確認", { exact: true }).click({ button: "right" });
        await page.getByRole("menuitem", { name: "リアクション ›", exact: true }).click();
        await page.getByRole("menuitem", { name: "＋ 所有している絵文字", exact: true }).click();
        await page.getByRole("dialog", { name: "絵文字でリアクション" }).getByRole("button", { name: "✨", exact: true }).click();
      } else {
        await press(page, native.getByRole("button", { name: "絵文字リアクションの確認", exact: true }), true);
        if (mode !== "apple") await press(page, native.getByRole("button", { name: "リアクション", exact: true }));
        await press(page, native.getByRole("button", { name: "所有している絵文字", exact: true }));
        await press(page, native.getByRole("button", { name: "✨", exact: true }));
      }
      const reactions = () => page.evaluate(async () => {
        const path = performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
        const state = (await import(path!)).useStore.getState();
        return { messages: state.messages.length, reactions: state.messages[0]?.reactions ?? [] };
      });
      await expect.poll(reactions).toMatchObject({ messages: 1, reactions: [{ type: 0, emoji: { productId: "demo-emoji", emojiId: "sparkle", version: 1, resourceType: 1 } }] });
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(output, `${mode}.png`) });
      if (mode === "legacy") await page.getByRole("button", { name: "リアクションを取り消す", exact: true }).click();
      else await press(page, native.getByRole("button", { name: "リアクション 1件", exact: true }));
      await expect.poll(reactions).toEqual({ messages: 1, reactions: [] });
      assert.deepEqual(errors, []);
      console.log(`${mode}: owned picker -> reaction badge -> remove, no message sent`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error(await (mode === "legacy" ? page.locator("body") : page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body")).ariaSnapshot());
      throw error;
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
