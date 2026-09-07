import { chromium, expect } from "@playwright/test";

// Uses the product's disconnected demo, never a LINE account or send operation.
const target = new URL(process.env.VYLINE_QA_URL ?? "http://127.0.0.1:5173/pr-demo");
if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/pr-demo") {
  throw new Error("NezuUI browser check requires a local /pr-demo page");
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await page.goto(target.href);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("button", { name: "外観・UI", exact: true }).click();
  await page.getByRole("radio", { name: "NezuUI NezuUI portable components", exact: true }).check();
  await page.getByRole("button", { name: "チャットに戻る", exact: true }).click();

  const editor = page.getByRole("textbox", { name: "メッセージを入力", exact: true });
  const trigger = page.getByRole("button", { name: "メニューを開く", exact: true });
  const menu = page.getByRole("group", { name: "作成メニュー", exact: true });
  await editor.fill("NezuUI draft\n二行目を保持");
  await trigger.click();
  await expect(menu).toBeVisible();
  await trigger.press("Tab");
  await expect(menu.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  await editor.click();
  await expect(menu).toBeHidden();
  await expect(editor).toHaveValue("NezuUI draft\n二行目を保持");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".nezu-composer-surface")).toHaveCSS("transform", "none");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(editor).toBeVisible();
  await expect
    .poll(() => editor.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(200);
  await page.getByRole("button", { name: "このトークを閉じて一覧に戻る", exact: true }).click();
  await expect(page.getByRole("button", { name: "設定", exact: true })).toBeVisible();
  console.log(
    "NezuUI browser check passed: switching, draft, menu, keyboard, reduced motion, narrow layout",
  );
} finally {
  await browser.close();
}
