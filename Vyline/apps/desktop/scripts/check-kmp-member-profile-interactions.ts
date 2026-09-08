import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-member-profile-interactions");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];

async function tap(page: Page, locator: Locator) {
  await expect(locator).toBeAttached();
  const box = await locator.boundingBox();
  assert(box && box.width > 0 && box.height > 0);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "light" }, version: 0 })), mode);
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const sender = native.getByRole("button", { name: "あおいのプロフィール", exact: true }).first();
      const profile = page.getByRole("dialog", { name: "あおい のプロフィール", exact: true });
      const restored = async () => {
        await expect(profile).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("Vyline Compose UI");
      };

      await tap(page, sender);
      await expect(profile).toBeVisible();
      assert(await profile.evaluate(dialog => dialog.matches(":modal")));
      await expect(profile.getByRole("button", { name: "閉じる", exact: true })).toBeFocused();
      await expect(profile.getByRole("button", { name: "ブロック", exact: true })).toBeDisabled();
      await expect(profile).toContainText("ログイン後にブロック操作を利用できます。");
      const controls = await profile.locator("button:not([disabled])").count();
      for (const key of ["Tab", "Shift+Tab"]) {
        for (let index = 0; index < controls + 2; index++) {
          await page.keyboard.press(key);
          const focus = await profile.evaluate(dialog => ({
            modal: dialog.matches(":modal"), inside: dialog.contains(document.activeElement),
            browserChrome: document.activeElement === document.body,
          }));
          assert(focus.modal && (focus.inside || focus.browserChrome), `${mode}: ${key} entered the background app`);
          // Native dialogs still allow Chromium's browser chrome in the tab order.
          // The next key must return to the dialog, never the background iframe.
          if (focus.browserChrome) {
            await page.keyboard.press(key);
            assert(await profile.evaluate(dialog => dialog.contains(document.activeElement)));
          }
        }
      }
      await page.screenshot({ path: resolve(output, `${mode}-member-profile.png`) });
      await page.keyboard.press("Escape");
      await restored();

      await tap(page, sender);
      await expect(profile).toBeVisible();
      await profile.getByRole("button", { name: "閉じる", exact: true }).click();
      await restored();

      await tap(page, sender);
      await expect(profile).toBeVisible();
      await page.touchscreen.tap(4, 50);
      await restored();
      assert.deepEqual(errors, []);
      results.push({ mode, senderTouch: true, nativeModal: true, tabAndShiftTabKeepBackgroundInert: true,
        escapeCloseBackdrop: true, composeIframeFocusRestored: true, unauthenticatedBlockReason: true, errors });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error({ mode, errors, html: await page.locator("body").ariaSnapshot() });
      throw error;
    } finally { await page.close(); }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(results);
} finally { await browser.close(); }
