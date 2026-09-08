import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-readers-plus-layout");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
async function tap(page: Page, target: Locator) {
  await expect(target).toBeAttached();
  let previous = "";
  await expect.poll(async () => {
    const next = JSON.stringify(await target.boundingBox());
    const stable = next !== "null" && next === previous;
    previous = next; return stable;
  }, { intervals: [100] }).toBe(true);
  const box = await target.boundingBox(); assert(box && box.width > 0 && box.height > 0);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: true });
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      const key = `${mode}-${viewport.width}x${viewport.height}`;
      let stage = "initial readers layout";
      try {
        await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "light" }, version: 0 })), mode);
        await page.goto(`${base}/pr-demo`);
        await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
        const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
        await page.waitForTimeout(500); // Allow native surface and symbol transitions to finish before visual capture.
        await page.screenshot({ path: resolve(output, `${key}-before.png`) });
        const lastReaders = native.getByRole("button", { name: "既読者一覧 2人", exact: true }).last();
        const readersBounds = await lastReaders.boundingBox();
        const composerBounds = await native.getByRole("textbox", { name: "メッセージを入力", exact: true }).boundingBox();
        assert(readersBounds && composerBounds && readersBounds.y + readersBounds.height <= composerBounds.y);
        await tap(page, lastReaders);
        await expect(native.getByRole("button", { name: "既読一覧を閉じる", exact: true })).toBeAttached();
        const readerProfiles = native.getByRole("button", { name: /プロフィールを開く$/ });
        await expect(readerProfiles).toHaveCount(2);
        for (const reader of await readerProfiles.all()) await expect(reader.getByRole("button")).toHaveCount(0);
        await page.waitForTimeout(500);
        await page.screenshot({ path: resolve(output, `${key}-readers.png`) });
        const close = native.getByRole("button", { name: "閉じる", exact: true });
        const closeBounds = await close.boundingBox(); assert(closeBounds);
        assert(closeBounds.x >= 0 && closeBounds.x + closeBounds.width <= viewport.width);
        assert(closeBounds.height >= 44);
        stage = "readers Tab cycle";
        for (let index = 0; index < 20; index++) await page.keyboard.press("Tab");
        for (let index = 0; index < 20; index++) await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Enter");
        await expect(native.getByRole("button", { name: "既読一覧を閉じる", exact: true })).toHaveCount(0);
        await tap(page, lastReaders);
        stage = "reader profile round trip";
        await tap(page, readerProfiles.first());
        const profile = page.getByRole("dialog", { name: "あおい のプロフィール", exact: true });
        await expect(profile).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(profile).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
        stage = "readers Escape after profile";
        await page.keyboard.press("Escape");
        await expect(native.getByRole("button", { name: "既読一覧を閉じる", exact: true })).toHaveCount(0);
        await tap(page, lastReaders);
        await expect(close).toBeAttached();
        stage = "reader keyboard initial activation";
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect(profile).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(profile).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
        // Keep the selected reader focused when the parent dialog returns to the canvas.
        stage = "reader keyboard focus after profile";
        await page.keyboard.press("Enter");
        await expect(profile).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(profile).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
        await tap(page, close);
        await expect(native.getByRole("button", { name: "既読一覧を閉じる", exact: true })).toHaveCount(0);
        if (mode === "apple") await tap(page, native.getByRole("button", { name: "添付とその他の操作", exact: true }));
        stage = "plus menu";
        await page.waitForTimeout(500);
        await page.screenshot({ path: resolve(output, `${key}-composer-tools.png`) });
        await tap(page, native.getByRole("button", { name: "ノート・アルバム・イベント", exact: true }));
        const plus = page.getByRole("dialog", { name: "ノート・アルバム・イベント", exact: true });
        await expect(plus).toBeVisible();
        await page.waitForTimeout(500);
        await page.screenshot({ path: resolve(output, `${key}-plus-menu.png`) });
        const plusBounds = await plus.boundingBox(); assert(plusBounds);
        assert(plusBounds.x >= 0 && plusBounds.y >= 0 && plusBounds.x + plusBounds.width <= viewport.width && plusBounds.y + plusBounds.height <= viewport.height);
        await page.keyboard.press("Escape");
        await expect(plus).toHaveCount(0);
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        assert(width <= viewport.width);
        assert.deepEqual(errors, []);
        results.push({ mode, viewport, dpr: 2, readersClose: closeBounds, plusMenu: plusBounds, documentWidth: width, errors });
      } catch (error) {
        await page.screenshot({ path: resolve(output, `${key}-failure.png`) });
        console.error({ key, stage, errors, native: await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot() });
        throw error;
      } finally { await page.close(); }
    }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(results);
} finally { await browser.close(); }
