import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = new URL(process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173");
assert(["localhost", "127.0.0.1"].includes(base.hostname));
const output = resolve(import.meta.dir, "../test-results/unread-boundary");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
const label = "ここから未読メッセージ";
try {
  for (const mode of ["legacy", "nezu", "apple", "fluent", "miuix"]) {
    for (const width of [1440, 390]) {
      const appearance = width === 390 ? "dark" : "light";
      const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: "block" });
      const errors: string[] = [];
      const apiRequests: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
        return url.origin !== base.origin || url.pathname.startsWith("/api/") ? route.abort() : route.continue();
      });
      try {
        await page.addInitScript(({ mode, appearance }) => localStorage.setItem("vyline:design-system",
          JSON.stringify({ state: { mode, appearance }, version: 0 })), { mode, appearance });
        await page.goto(`${base.origin}/pr-demo`, { waitUntil: "domcontentloaded" });
        const compose = ["apple", "fluent", "miuix"].includes(mode);
        if (compose) await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('.vy-composer textarea[aria-label="メッセージを入力"]')).toBeAttached();
        await page.evaluate(async () => {
          const loaded = performance.getEntriesByType("resource").map(entry => entry.name)
            .find(url => new URL(url).pathname === "/src/lib/store.ts");
          if (!loaded) throw new Error("Loaded store not found");
          const { useStore } = await import(loaded);
          if (!useStore.getState().demoMode || useStore.getState().accountId !== null) throw new Error("Isolated demo required");
          (window as any).__unreadFixture = useStore;
          const now = Date.now();
          const message = (id: string, text: string, createdAt: number, authorId = "u-peer", read = false) => ({
            id, chatId: "c-unread-browser", authorId, kind: "text", text, createdAt, read,
            status: read ? "read" : "sent", messageState: "normal",
          });
          useStore.getState().closeChat();
          useStore.setState({ unreadBoundaries: {},
            chats: [{ id: "c-unread-browser", type: "group", name: "未読テスト", avatar: "T", color: "#607d8b",
              unread: 2, status: "", lastMessageId: "40", members: [{ id: "u-peer", name: "テスト相手", avatar: "T", color: "#607d8b" }] }],
            messages: [message("10", "前回ここまで読みました", now - 86_400_000, "u-peer", true),
              message("20", "未読の最初のメッセージ", now - 120_000),
              message("30", "続きの未読メッセージ", now - 60_000),
              message("40", "自分のメッセージは未読件数に含めません", now, "me")],
          });
          useStore.getState().openChat("c-unread-browser");
        });
        const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
        const marker = compose ? native.getByText(label, { exact: true }) : page.getByRole("separator", { name: label, exact: true });
        await expect(marker).toBeVisible();
        const target = compose ? native.getByRole("button", { name: "未読の最初のメッセージ", exact: true })
          : page.locator("#msg-20");
        await expect(target).toBeAttached();
        await expect.poll(async () => {
          const [line, row] = await Promise.all([marker.boundingBox(), target.boundingBox()]);
          return !!line && !!row && line.y + line.height <= row.y + 1 && row.y - (line.y + line.height) < 100;
        }).toBe(true);
        await page.evaluate(async () => {
          const store = (window as any).__unreadFixture;
          await store.getState().markChatRead("c-unread-browser");
          if (store.getState().unreadBoundaries["c-unread-browser"].messageId !== "20") throw new Error("read marking moved the opening boundary");
          store.setState({ messages: [...store.getState().messages, { ...store.getState().messages[1], id: "50", text: "あとから受信したメッセージ", createdAt: Date.now() + 1000, read: false }] });
        });
        await expect(marker).toBeVisible();
        await page.screenshot({ path: resolve(output, `${mode}-${appearance}-${width}.png`) });
        await page.evaluate(() => { const store = (window as any).__unreadFixture; store.getState().closeChat(); store.getState().openChat("c-unread-browser"); });
        await expect(marker).toHaveCount(0);
        assert.deepEqual(errors, []);
        assert.deepEqual(apiRequests, []);
        results.push({ mode, width, appearance, exactBoundary: "20", readMarkingRetained: true, reopenCleared: true, errors, apiRequests });
        console.log(`${mode} ${width} ${appearance}: unread boundary PASS`);
      } catch (error) {
        await page.screenshot({ path: resolve(output, `${mode}-${width}-failure.png`) });
        throw error;
      } finally { await page.close(); }
    }
  }
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
