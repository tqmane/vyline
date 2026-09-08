import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-advanced-reachability");
const sections = ["プロフィール", "既読", "表示", "外観・UI", "通知", "プライバシー", "詳細・復元", "サブデバイス", "ストレージ", "通話記録", "プラグイン", "ベータ機能", "引継ぎ・診断", "情報"];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
async function click(page: Page, locator: Locator) {
  await expect(locator).toBeAttached();
  const box = await locator.boundingBox(); assert(box && box.width > 0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "light" }, version: 0 })), mode);
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const createGroup = native.getByRole("button", { name: "グループを作成", exact: true }).first();
      const groupDialog = page.getByRole("dialog", { name: "グループを作成", exact: true });
      await click(page, createGroup);
      await expect(groupDialog).toBeVisible();
      assert(await groupDialog.evaluate(dialog => dialog.matches(":modal")));
      await expect(groupDialog.getByRole("button", { name: "閉じる", exact: true })).toBeFocused();
      await groupDialog.getByPlaceholder("グループ名（任意）").fill("未送信の確認用グループ");
      await groupDialog.getByPlaceholder("友だちを検索").fill("サンプルサポート");
      await groupDialog.getByRole("button", { name: /サンプルサポート/ }).click();
      await expect(groupDialog).toContainText("選択中 1 人");
      await expect(groupDialog.getByRole("button", { name: "グループを作成", exact: true })).toBeDisabled();
      await expect(groupDialog).toContainText("ログイン後にグループを作成できます。");
      await page.screenshot({ path: resolve(output, `${mode}-create-group-login-required.png`) });
      await page.keyboard.press("Escape");
      await expect(groupDialog).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("Vyline Compose UI");
      await click(page, createGroup);
      await expect(groupDialog).toBeVisible();
      await groupDialog.getByRole("button", { name: "閉じる", exact: true }).click();
      await expect(groupDialog).toHaveCount(0);

      if (mode === "apple") await click(page, native.getByRole("button", { name: "添付とその他の操作", exact: true }));
      await click(page, native.getByRole("button", { name: "ノート・アルバム・イベント", exact: true }));
      const plus = page.getByRole("dialog", { name: "ノート・アルバム・イベント", exact: true });
      await expect(plus).toBeVisible();
      await expect(plus).toContainText("ログイン後に利用できます。");
      const plusItems = ["イベントを作成", "あみだくじ", "アンケート", "ノート", "アルバム"];
      for (const name of plusItems) await expect(plus.getByRole("button", { name: new RegExp(name) })).toBeDisabled();
      await page.screenshot({ path: resolve(output, `${mode}-plus-login-required.png`) });
      await page.keyboard.press("Escape");
      await expect(plus).toHaveCount(0);
      const settings = native.getByRole("button", { name: "設定", exact: true });
      await click(page, mode === "apple" ? settings.first() : settings.last());
      await page.mouse.move(1400, 990);
      // Apple's composer settings is a small chooser; sidebar Settings opens the screen directly.
      if (await native.getByRole("button", { name: "すべての設定", exact: true }).count())
        await click(page, native.getByRole("button", { name: "すべての設定", exact: true }));
      const advanced = native.getByRole("button", { name: "アカウント・バックアップ・詳細設定", exact: true });
      await expect(advanced).toBeAttached();
      await page.mouse.move(1080, 760); await page.mouse.wheel(0, 650);
      await expect.poll(async () => (await advanced.boundingBox())?.y ?? 5000).toBeLessThan(920);
      await click(page, advanced);
      const dialog = page.getByRole("dialog", { name: "詳細設定", exact: true });
      await expect(dialog).toBeVisible();
      assert(await dialog.evaluate(element => element.matches(":modal")));
      await expect(dialog.getByRole("button", { name: "チャットに戻る", exact: true })).toBeFocused();
      const nav = dialog.getByRole("navigation", { name: "設定カテゴリ", exact: true });
      const account = nav.getByRole("button").filter({ hasText: "未ログイン" });
      await account.click();
      await expect(nav.getByRole("button", { name: /アカウントを追加/ })).toBeVisible();
      await account.click();
      await expect(nav.getByRole("button", { name: /アカウントを追加/ })).toHaveCount(0);
      await nav.getByRole("button", { name: "外観・UI", exact: true }).click();
      await dialog.getByRole("radio", { name: "ダーク", exact: true }).check();
      await expect(dialog.getByRole("radio", { name: "ダーク", exact: true })).toBeChecked();
      await dialog.getByRole("radio", { name: "ライト", exact: true }).check();
      await expect(dialog.getByRole("radio", { name: "ライト", exact: true })).toBeChecked();
      const sectionResults: object[] = [];
      for (const name of sections) {
        const button = nav.getByRole("button", { name, exact: true });
        await button.click();
        await expect(button).toHaveAttribute("aria-current", "page");
        const content = dialog.locator(".vy-settings-scroll");
        await expect(content).not.toHaveText("");
        sectionResults.push({ name, headings: await content.locator("h1,h2,h3").allTextContents(), accountRequired: /ログイン/.test(await content.innerText()) });
      }
      await page.screenshot({ path: resolve(output, `${mode}-advanced-settings.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("Vyline Compose UI");
      await click(page, advanced);
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "チャットに戻る", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await click(page, native.getByRole("button", { name: "設定を閉じる", exact: true }));
      await expect(native.getByRole("textbox", { name: "メッセージを入力", exact: true })).toBeAttached();
      assert.deepEqual(errors, []);
      results.push({ mode, createGroupSelectionAndLoginReason: true, createGroupEscapeCloseAndFocus: true,
        advancedSections: sectionResults, settingsInlineAccountAndAppearance: true,
        advancedInitialFocusAndEscape: true, advancedBackAndNativeClose: true,
        plus: plusItems.map(name => ({ name, enabled: false, reason: "ログイン後に利用できます" })), plusEscape: true, errors });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) }); console.error({ mode, errors, native: await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot() }); throw error;
    } finally { await page.close(); }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(results);
} finally { await browser.close(); }
