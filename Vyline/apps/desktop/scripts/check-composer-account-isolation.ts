import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = new URL(process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173");
assert(["localhost", "127.0.0.1"].includes(base.hostname));
const output = resolve(import.meta.dir, "../test-results/composer-account-isolation");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const results: object[] = [];
try {
  for (const mode of ["legacy", "apple"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, serviceWorkers: "block" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    // Synthetic in-memory account IDs only; no request can reach an account API.
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return url.origin !== base.origin || url.pathname.startsWith("/api/") ? route.abort() : route.continue();
    });
    await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 })), mode);
    try {
      await page.goto(`${base.origin}/pr-demo`, { waitUntil: "domcontentloaded" });
      if (mode === "apple") await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.vy-composer textarea[aria-label="メッセージを入力"]')).toBeAttached();
      await page.evaluate(async () => {
        if (location.pathname !== "/pr-demo") throw new Error("Demo required");
        const loaded = (path: string) => {
          const value = performance.getEntriesByType("resource").map(entry => entry.name).findLast(url => new URL(url).pathname === path);
          if (!value) throw new Error(`Not loaded: ${path}`);
          return value;
        };
        const { useStore } = await import(loaded("/src/lib/store.ts"));
        const { getComposerController } = await import(loaded("/src/ui/composer-controller.ts"));
        const { useDesignSystemStore } = await import(loaded("/src/ui/design-system-store.ts"));
        if (!useStore.getState().demoMode || useStore.getState().accountId !== null) throw new Error("Fresh demo required");
        const fixture = { useStore, getComposerController, useDesignSystemStore,
          chatId: useStore.getState().activeChatId, old: null as any, revoked: [] as string[], url: "" };
        const originalRevoke = URL.revokeObjectURL;
        URL.revokeObjectURL = url => { fixture.revoked.push(url); originalRevoke.call(URL, url); };
        (window as any).__composerAudit = fixture;
        useStore.setState({ accountId: "fixture-account-a", drafts: { [fixture.chatId]: "アカウントAの下書き" } });
      });
      const snapshot = () => page.evaluate(() => {
        const f = (window as any).__composerAudit;
        return f.getComposerController(f.chatId)?.snapshot ?? null;
      });
      await expect.poll(async () => (await snapshot())?.accountId).toBe("fixture-account-a");
      await page.locator('.vy-composer input[type="file"]').setInputFiles({ name: "account-a-only.txt", mimeType: "text/plain", buffer: Buffer.from("fixture, never uploaded") });
      await expect.poll(async () => (await snapshot())?.pending.length).toBe(1);
      await page.evaluate(() => {
        const f = (window as any).__composerAudit;
        f.old = f.getComposerController(f.chatId);
        f.url = f.old.snapshot.pending[0].url;
        f.old.setText("選択範囲を保持する", 2, 5);
        f.useDesignSystemStore.setState({ mode: "fluent" });
      });
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      await expect.poll(async () => {
        const state = await snapshot();
        return [state?.text, state?.selectionStart, state?.selectionEnd, state?.pending.length];
      }).toEqual(["選択範囲を保持する", 2, 5, 1]);
      await page.screenshot({ path: resolve(output, `${mode}-theme-preserved.png`) });
      await page.evaluate(() => (window as any).__composerAudit.old.startRecording());
      await expect.poll(async () => (await snapshot())?.recording).toBe(true);
      await page.evaluate(() => {
        const f = (window as any).__composerAudit;
        f.useStore.setState({ accountId: "fixture-account-b", drafts: { [f.chatId]: "B" } });
      });
      await expect.poll(async () => {
        const state = await snapshot();
        return [state?.accountId, state?.text, state?.pending.length, state?.recording];
      }).toEqual(["fixture-account-b", "B", 0, false]);
      await expect.poll(() => page.evaluate(() => {
        const f = (window as any).__composerAudit;
        return f.revoked.includes(f.url);
      })).toBe(true);
      await page.evaluate(() => {
        const f = (window as any).__composerAudit;
        f.useStore.setState({ accountId: "fixture-account-a", drafts: { [f.chatId]: "新しいA" } });
      });
      await expect.poll(async () => (await snapshot())?.text).toBe("新しいA");
      await page.evaluate(() => {
        const f = (window as any).__composerAudit;
        f.old.addFiles([new File(["stale"], "stale.txt")]);
        f.old.setText("stale draft must not return", 0, 0);
        f.old.setSelection(0, 0);
      });
      await page.waitForTimeout(150);
      const final = await snapshot();
      assert.equal(final?.text, "新しいA");
      assert.equal(final?.pending.length, 0);
      assert.equal(final?.recording, false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `${mode}-account-reset.png`) });
      results.push({ mode, themePreservedFilesAndSelection: true, accountChangeClearedFilesAndRecording: true,
        releasedPreviewUrl: true, retiredControllerRejectedAfterRoundTrip: true, errors });
      console.log(`${mode}: account/recording/file ownership and theme retention passed`);
    } finally { await page.close(); }
  }
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
