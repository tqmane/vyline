import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Page, type Locator } from "@playwright/test";
const base = "http://127.0.0.1:5186";
const output = resolve(import.meta.dir, "../test-results/apple-message-menu");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function press(page: Page, locator: Locator, hold = false) {
  await expect(locator).toBeAttached();
  await page.waitForTimeout(350);
  const bounds = await locator.boundingBox(); assert(bounds && bounds.width > 0 && bounds.height > 0);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); if (hold) await page.waitForTimeout(700); await page.mouse.up();
}
try {
  for (const width of [390, 980]) for (const appearance of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => { const url = new URL(route.request().url()); return (url.origin !== base && url.origin !== "https://stickershop.line-scdn.net") || url.pathname.startsWith("/api/") ? route.abort() : route.continue(); });
    await page.addInitScript(appearance => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode: "apple", appearance }, version: 0 })), appearance);
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 90_000 });
      await page.evaluate(async () => {
        const path = performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
        const { useStore } = await import(path!); const state = useStore.getState();
        if (!state.demoMode || state.accountId !== null) throw new Error("Demo only");
        useStore.setState({ chats: state.chats.map(chat => chat.id === state.activeChatId ? { ...chat, type: "friend", members: undefined } : chat), messages: [
          { id: "reference-message", chatId: state.activeChatId, authorId: "contact", kind: "text", text: "週末は写真を撮りに行こう", createdAt: Date.now(), status: "sent", read: false, messageState: "normal" },
          { id: "reference-other", chatId: state.activeChatId, authorId: "me", kind: "text", text: "いいね、楽しみ！", createdAt: Date.now(), status: "sent", read: false, messageState: "normal" },
        ] });
      });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const message = native.getByRole("button", { name: "週末は写真を撮りに行こう", exact: true });
      const original = await message.boundingBox(); assert(original);
      await press(page, message, true);
      const reactions = native.getByLabel("リアクションバー", { exact: true });
      const preview = native.getByLabel("選択したメッセージ", { exact: true });
      const reply = native.getByRole("button", { name: "返信", exact: true });
      await expect(reactions).toBeAttached(); await expect(preview).toBeAttached(); await expect(reply).toBeAttached();
      for (const name of ["愛してる", "いいね", "面白い", "コピー", "部分コピー", "その他"]) await expect(native.getByRole("button", { name, exact: true })).toBeAttached();
      await page.waitForTimeout(400);
      const top = await reactions.boundingBox(); const bubble = await preview.boundingBox(); const bottom = await reply.boundingBox();
      assert(top && bubble && bottom);
      assert(Math.abs(bubble.x - original.x) < 2 && Math.abs(bubble.width - original.width) < 2, JSON.stringify({original,bubble}));
      const plus = await native.getByRole("button", { name: "所有している絵文字", exact: true }).boundingBox(); assert(plus);
      for (const name of ["愛してる", "いいね", "面白い", "すごい", "悲しい", "びっくり"]) {
        const item = await native.getByRole("button", {name, exact: true}).boundingBox(); assert(item && item.x < plus.x);
      }
      assert(top.y + top.height <= bubble.y + 1 && bubble.y + bubble.height < bottom.y);
      await page.screenshot({ path: resolve(output, `${appearance}-${width}.png`) });
      await press(page, native.getByRole("button", { name: "その他", exact: true }));
      await expect(native.getByRole("button", { name: "このメッセージまで既読", exact: true })).toBeAttached();
      const parent = native.getByLabel("親メニュー", {exact: true}); const child = native.getByLabel("サブメニュー", {exact: true});
      await expect(parent).toBeAttached(); await expect(child).toBeAttached();
      await page.waitForTimeout(400);
      const parentBounds = await parent.boundingBox(); const childBounds = await child.boundingBox();
      assert(parentBounds && childBounds && childBounds.y > parentBounds.y);
      await page.screenshot({ path: resolve(output, `${appearance}-${width}-submenu.png`) });
      await press(page, native.getByRole("button", { name: "その他を閉じる", exact: true }));
      await press(page, native.getByRole("button", { name: "部分コピー", exact: true }));
      await expect(native.getByRole("button", { name: "選択範囲をコピー", exact: true })).toBeAttached();
      await press(page, native.getByRole("button", { name: "閉じる", exact: true }).first());
      await press(page, message, true); await press(page, reply);
      await expect.poll(() => page.evaluate(async () => {
        const path = performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
        return (await import(path!)).useStore.getState().replyToId;
      })).toBe("reference-message");
      await expect(reactions).toHaveCount(0);
      const longText = "文字数を増やしてもリアクションバーは同じ幅です。メッセージ本体だけが本文の長さに合わせて表示されます。";
      await page.evaluate(async text => {
        const path = performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
        const { useStore } = await import(path!);
        useStore.setState(state => ({ replyToId: null, messages: state.messages.map(message => message.id === "reference-message" ? {...message, text} : message) }));
      }, longText);
      const longMessage = native.getByRole("button", {name: longText, exact: true});
      await expect(longMessage).toBeAttached(); await page.waitForTimeout(400);
      const longOriginal = await longMessage.boundingBox(); assert(longOriginal);
      await press(page, longMessage, true); await expect(reactions).toBeAttached(); await page.waitForTimeout(500);
      const longBar = await reactions.boundingBox(); const longBubble = await preview.boundingBox();
      assert(longBar && longBubble && Math.abs(longBar.width - top.width) < 1);
      assert(Math.abs(longBubble.x - longOriginal.x) < 2 && Math.abs(longBubble.width - longOriginal.width) < 2);
      await page.screenshot({path: resolve(output, `${appearance}-${width}-long.png`)});
      assert.deepEqual(errors, []); console.log(`${appearance}: glass menu layout, more, selection and reply passed`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${appearance}-${width}-failure.png`) });
      console.error(errors, await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot()); throw error;
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
