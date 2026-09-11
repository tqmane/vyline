import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium, expect, type Locator } from "@playwright/test";
const base = "http://127.0.0.1:5186";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
try {
  await page.route("**/*", route => { const url = new URL(route.request().url()); return url.origin !== base || url.pathname.startsWith("/api/") ? route.abort() : route.continue(); });
  await page.addInitScript(() => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode: "apple", appearance: "dark" }, version: 0 })));
  await page.goto(`${base}/pr-demo`);
  await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 90_000 });
  const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
  const button = (name: string) => native.getByRole("button", { name, exact: true });
  const click = async (target: Locator) => {
    await expect(target).toBeAttached(); await page.waitForTimeout(600);
    const bounds = await target.boundingBox(); assert(bounds);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  };
  await click(button("添付とその他の操作")); await click(button("設定").last());
  const sidebar = native.getByLabel("設定サイドバー", { exact: true });
  await expect(button("設定サイドバーを閉じる")).toBeAttached();
  await page.waitForTimeout(700);
  assert((await sidebar.boundingBox())!.width > 200);
  await click(button("設定サイドバーを閉じる"));
  await expect(button("設定サイドバーを開く")).toBeAttached(); await page.waitForTimeout(700);
  assert((await sidebar.boundingBox())!.width < 90);
  await click(button("設定サイドバーを開く"));
  await page.screenshot({ path: resolve(import.meta.dir, "../test-results/apple-settings-wide.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(button("設定サイドバーを開く")).toBeAttached();
  await click(native.getByRole("tab", { name: "外観・UI", exact: true }));
  await expect(native.getByRole("tab", { name: "外観・UI", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: resolve(import.meta.dir, "../test-results/apple-settings-narrow.png") });
  await click(button("設定サイドバーを開く"));
  await expect(button("設定サイドバーを閉じる")).toBeAttached();
  await click(native.getByRole("tab", { name: "プロフィール", exact: true }));
  await expect(button("設定サイドバーを開く")).toBeAttached();
  console.log("Apple settings: rounded sidebar, explicit toggle, narrow rail and selection passed");
} finally { await browser.close(); }
