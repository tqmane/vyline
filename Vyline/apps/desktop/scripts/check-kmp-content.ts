import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(
  import.meta.dir,
  process.env.VYLINE_TEST_OUTPUT ?? "../test-results/kmp-content",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
async function click(page: Page, locator: Locator) {
  await expect(locator).toBeAttached();
  const bounds = await locator.boundingBox();
  assert(bounds);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}
try {
  for (const mode of ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (mode) =>
        localStorage.setItem(
          "vyline:design-system",
          JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
        ),
      mode,
    );
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      await click(
        page,
        native
          .getByRole("button")
          .filter({ hasText: "機能ギャラリー" })
          .filter({ hasText: "あなた:" }),
      );
      await expect(native.locator(".vy-kmp-inline-content").first()).toBeAttached({
        timeout: 15_000,
      });
      const seen = new Set<string>();
      for (let step = 0; step < 8; step++) {
        for (const card of await native.locator(".vy-kmp-inline-content").all()) {
          if (!(await card.isVisible())) continue;
          const value = (await card.textContent()) ?? "";
          for (const expected of [
            "LINEをもっと自分らしく",
            "グループ通話が終了しました",
            "Vyline-デモ資料.pdf",
            "サンプル区デモ通り 1-2-3",
          ])
            if (value.includes(expected)) seen.add(expected);
        }
        if (seen.size === 4) break;
        await page.mouse.move(1020, 360);
        await page.mouse.wheel(0, -470);
        // Let the lazy list mount its next range and measure hosted card heights.
        await page.waitForTimeout(200);
      }
      assert.equal(seen.size, 4, `Inline content missing: ${[...seen]}`);
      const bounds = await native.locator(".vy-kmp-inline-content").evaluateAll((nodes) =>
        nodes.map((node) => ({
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
          scrollWidth: node.scrollWidth,
        })),
      );
      assert(
        bounds.every(
          (rect) => rect.height > 0 && rect.width > 0 && rect.scrollWidth <= rect.width + 1,
        ),
      );
      await page.screenshot({ path: resolve(output, `${mode}-inline-cards.png`) });
      assert.deepEqual(errors, []);
      results.push({ base, mode, seen: [...seen], bounds, errors });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error({
        mode,
        errors,
        content: await page
          .frameLocator('iframe[title="Vyline Compose UI"]')
          .locator(".vy-kmp-inline-content")
          .allTextContents()
          .catch(() => []),
      });
      throw error;
    } finally {
      await page.close();
    }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(results);
} finally {
  await browser.close();
}
