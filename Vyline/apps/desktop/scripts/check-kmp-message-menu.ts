import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

// Offline: real Compose gestures and host callbacks, never a LINE account.
const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-message-menu");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
async function click(page: Page, locator: Locator, longPress = false) {
  await expect(locator).toBeAttached();
  await page.waitForTimeout(300); // Finish the native surface enter/exit before the next gesture.
  const rect = await locator.boundingBox();
  assert(rect);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  if (longPress) await page.waitForTimeout(650);
  await page.mouse.up();
}
try {
  for (const mode of ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors: string[] = [];
    let stage = "load";
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });
    await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "light" }, version: 0 })), mode);
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 90_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      await page.evaluate(async () => {
        const { useStore } = await import(performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!);
        const state = useStore.getState();
        if (!state.demoMode || state.accountId !== null) throw new Error("Demo-only check");
        const id = state.activeChatId;
        useStore.setState({
          chats: state.chats.map(chat => chat.id === id ? { ...chat, type: "friend", members: undefined, avatarUrl: `${location.origin}/demo/sticker-ok.svg` } : chat),
          messages: [{ id: "menu-incoming", chatId: id, authorId: "contact", kind: "text", text: "長押し操作の確認", createdAt: Date.now(), status: "sent", messageState: "normal", read: false }],
        });
      });
      const menuCommand = async (label: string) => {
        stage = label;
        if (mode === "apple") {
          await expect(native.getByLabel("選択したメッセージ", { exact: true })).toBeAttached();
          await page.waitForTimeout(300);
        }
        const names: Record<string, string> = { "リプライ": "返信", "部分コピー": "部分コピー", "リアクション": "いいね" };
        const target = native.getByRole("button", { name: mode === "apple" ? names[label] ?? label : label, exact: true });
        if (mode === "apple" && await target.count() === 0) {
          const back = native.getByRole("button", { name: "その他を閉じる", exact: true });
          if (await back.count()) { await click(page, back); await expect(back).toHaveCount(0); }
          if (await target.count() === 0) await click(page, native.getByRole("button", { name: "その他", exact: true }));
        }
        return target;
      };
      const incoming = native.getByRole("button", { name: "長押し操作の確認", exact: true });
      const open = async () => {
        await click(page, incoming, true);
        await expect(await menuCommand("部分コピー")).toBeAttached();
        await expect(native.getByRole("button", { name: "詳細・その他の操作", exact: true })).toHaveCount(0);
        await expect(native.getByText("メッセージの詳細", { exact: true })).toHaveCount(0);
      };
      await open();
      for (const label of ["リプライ", "リアクション", "コピー", "このメッセージまで既読"])
        await expect(await menuCommand(label)).toBeAttached();
      await page.screenshot({ path: resolve(output, `${mode}-menu.png`) });
      await click(page, await menuCommand("部分コピー"));
      await expect(native.getByText("コピーしたい範囲を選択してください", { exact: true })).toBeAttached();
      await expect(native.getByRole("button", { name: "選択範囲をコピー", exact: true })).toBeAttached();
      await click(page, native.getByRole("button", { name: "閉じる", exact: true }).first());
      await expect(native.getByRole("button", { name: "選択範囲をコピー", exact: true })).toHaveCount(0);
      await open();
      await click(page, await menuCommand("リプライ"));
      await expect.poll(() => page.evaluate(async () => (await import(performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!)).useStore.getState().replyToId)).toBe("menu-incoming");
      await page.evaluate(async () => {
        const { useStore } = await import(performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!);
        const state = useStore.getState();
        useStore.setState({ replyToId: null, messages: state.messages.map(message => ({ ...message, authorId: "me", text: "編集操作の確認", edited: true, originalText: "変更前の本文", history: [{ state: "normal", text: "変更前の本文", contentType: "NONE", updatedTime: Date.now() }] })) });
      });
      const outgoing = native.getByRole("button", { name: "編集操作の確認", exact: true });
      await click(page, outgoing, true);
      for (const label of ["編集", "編集前のメッセージを表示", "履歴を表示", "送信を取り消し"])
        await expect(await menuCommand(label)).toBeAttached();
      await click(page, await menuCommand("編集前のメッセージを表示"));
      await expect(native.getByText("変更前の本文", { exact: true })).toBeAttached();
      await click(page, native.getByRole("button", { name: "閉じる", exact: true }).first());
      await click(page, outgoing, true);
      await click(page, await menuCommand("編集"));
      await expect(native.getByRole("textbox", { name: "編集後のメッセージ", exact: true })).toBeAttached();
      await click(page, native.getByRole("button", { name: "閉じる", exact: true }).first());
      await click(page, outgoing, true);
      await click(page, await menuCommand("送信を取り消し"));
      await expect(native.getByText("相手のトークからもメッセージが取り消されます。", { exact: true })).toBeAttached();
      await click(page, native.getByRole("button", { name: "キャンセル", exact: true }));
      await expect.poll(() => page.evaluate(async () => (await import(performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!)).useStore.getState().messages[0]?.messageState)).toBe("normal");
      await page.evaluate(async () => {
        const { useStore } = await import(performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!);
        const state = useStore.getState();
        useStore.setState({
          chats: state.chats.map(chat => chat.id === state.activeChatId ? { ...chat, type: "group", members: [{ id: "contact", name: "送信者", avatar: "S", avatarUrl: `${location.origin}/demo/sticker-ok.svg`, color: "#00aa88" }] } : chat),
          settings: { ...state.settings, showReaderList: true },
          messages: state.messages.map(message => ({ ...message, kind: "image", authorId: "contact", text: "", altText: "画像操作の確認", imageSrc: `${location.origin}/demo/sticker-ok.svg`, edited: false, originalText: undefined, history: undefined })),
        });
      });
      // Native media's accessibility label contains the media description.
      const image = native.getByRole("button", { name: /画像操作の確認/ }).first();
      await click(page, image, true);
      const labels = await page.evaluate(async () => (await import(performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/ui\/native-menu\.ts(?:\?|$)/.test(url))!)).getNativeMenuSnapshot()?.items.map(item => item.label));
      assert(labels?.includes("画像をダウンロード"));
      assert(labels?.includes("既読者を表示"));
      assert(labels?.includes("アナウンスを追加"));
      assert(labels?.includes("このメッセージまで既読"));
      await click(page, native.getByRole("button", { name: mode === "apple" ? "メニューを閉じる" : "閉じる", exact: true }).first());
      assert.deepEqual(errors, []);
      console.log(`${mode}: direct message menu, partial copy, reply, original, edit and revoke cancellation passed`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error(stage, await page.locator('iframe[title="Vyline Compose UI"]').contentFrame().locator("body").ariaSnapshot());
      throw error;
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
