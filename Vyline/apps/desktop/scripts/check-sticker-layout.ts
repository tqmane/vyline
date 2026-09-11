import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";
const base = "http://127.0.0.1:5186";
const output = resolve(import.meta.dir, "../test-results/sticker-layout");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function click(page: Page, target: Locator, right = false) {
  await expect(target).toBeAttached(); await page.waitForTimeout(700);
  const bounds = await target.boundingBox(); assert(bounds);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { button: right ? "right" : "left" });
}
try {
  for (const mode of ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => { const url = new URL(route.request().url()); return url.origin !== base || url.pathname.startsWith("/api/") ? route.abort() : route.continue(); });
    await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 })), mode);
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 90_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const button = (name: string) => native.getByRole("button", { name, exact: true });
      await click(page, button("添付とその他の操作"));
      await click(page, button("スタンプと絵文字"));
      const packs = native.getByLabel("スタンプパック", { exact: true });
      const divider = native.getByLabel("パックとスタンプの区切り", { exact: true });
      await expect(packs).toBeAttached(); await expect(divider).toBeAttached();
      await page.waitForTimeout(700);
      const packBounds = await packs.boundingBox(); assert(packBounds && packBounds.height <= 55);
      const tabs = await native.getByLabel("スタンプのタブ", { exact: true }).boundingBox();
      const premium = await native.getByText("Premium —", { exact: true }).boundingBox();
      assert(tabs && premium && Math.abs(premium.y + premium.height / 2 - tabs.y - tabs.height / 2) <= 2);
      await page.screenshot({ path: resolve(output, `${mode}-picker.png`) });
      await click(page, button("サンプル太陽"), true);
      await click(page, button("＋ 組み合わせに追加"));
      const source = page.locator("[data-native-controller] [data-native-combo-x]").first();
      await expect(source).toBeAttached();
      await expect(native.getByRole("textbox", { name: "横位置", exact: true })).toHaveCount(0);
      const before = Number(await source.inputValue());
      const layer = native.getByLabel("サンプル太陽の位置を変更", { exact: true });
      await expect(layer).toBeAttached(); await page.waitForTimeout(1000);
      const bounds = await layer.boundingBox(); assert(bounds);
      await page.mouse.move(bounds.x + 20, bounds.y + 20); await page.mouse.down();
      await page.mouse.move(bounds.x + 50, bounds.y + 35, { steps: 12 }); await page.mouse.up();
      await expect.poll(async () => Number(await source.inputValue())).toBeGreaterThan(before);
      const expand = button("位置・サイズを調整");
      // Inspect source order independent of the scroll viewport.
      assert(await source.evaluate(input => {
        const details = input.closest("details")!;
        const grid = details.previousElementSibling;
        return !details.open && !!grid && !!(grid.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING);
      }));
      const pane = await native.getByRole("heading", { name: "スタンプ・絵文字", exact: true }).boundingBox(); assert(pane);
      await page.mouse.move(pane.x + 200, pane.y + 250); await page.mouse.wheel(0, 650); await page.waitForTimeout(1000);
      await click(page, expand);
      await expect(native.getByRole("textbox", { name: "横位置", exact: true })).toBeAttached();
      await page.screenshot({ path: resolve(output, `${mode}-combination.png`) });
      assert.deepEqual(errors, []);
      console.log(`${mode}: compact packs, aligned premium, collapsed controls below grid, drag retained`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error(await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot()); throw error;
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
