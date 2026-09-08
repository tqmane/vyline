import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect, type Locator } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5186";
const browser = await chromium.launch({ headless: true });
const output = `test-results/native-panels/${Date.now()}`;
await mkdir(output, { recursive: true });
console.log(`Artifacts: ${output}`);
const results: object[] = [];
try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { ok: true, chats: [], members: [], results: [], profiles: {}, items: [], records: [] } });
      return route.continue();
    });
    await page.addInitScript((mode) => {
      localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 }));
    }, mode);
    const settledBounds = async (locator: Locator) => {
      await expect(locator).toBeAttached();
      let previous = "";
      await expect.poll(async () => {
        const bounds = await locator.boundingBox();
        const current = JSON.stringify(bounds);
        const settled = bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900 && current === previous;
        previous = current;
        return !!settled;
      }).toBe(true);
      const box = await locator.boundingBox(); assert(box);
      return box;
    };
    const click = async (locator: Locator) => {
      const box = await settledBounds(locator);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
      const frame = page.frames().find((frame) => frame.url().includes("ui-compose"))!;
      const button = (label: string) => frame.getByRole("button", { name: label, exact: true });
      await click(button("グループを作成").first());
      const name = frame.getByRole("textbox", { name: "グループ名（任意）", exact: true });
      await click(name); await page.keyboard.insertText("ネイティブの入力確認");
      await expect(page.locator('[data-native-controller] input[placeholder="グループ名（任意）"]')).toHaveValue("ネイティブの入力確認");
      assert.equal(await page.locator("dialog:modal").count(), 0);
      await page.screenshot({ path: `${output}/${mode}-create.png` });
      await page.keyboard.press("Escape");
      await expect(name).toHaveCount(0);
      await click(button("添付とその他の操作"));
      await click(button("ノート・アルバム・イベント"));
      await expect(frame.getByText("ログイン後に利用できます。", { exact: true })).toBeAttached();
      assert.equal(await page.locator("dialog:modal").count(), 0);
      await page.screenshot({ path: `${output}/${mode}-tools.png` });
      await page.keyboard.press("Escape");
      await expect(frame.getByText("ログイン後に利用できます。", { exact: true })).toHaveCount(0);
      await click(button("設定").first());
      const advanced = button("アカウント・バックアップ・詳細設定");
      await expect(advanced).toBeAttached();
      await page.mouse.move(1060, 700); await page.mouse.wheel(0, 650);
      await expect.poll(async () => (await advanced.boundingBox())?.y ?? 9999).toBeLessThan(850);
      await click(advanced);
      await click(button("プロフィール").first());
      await expect(frame.getByRole("textbox", { name: /表示名|名前/ }).first()).toBeAttached();
      assert.equal(await page.locator("dialog:modal").count(), 0);
      await page.screenshot({ path: `${output}/${mode}-settings.png` });
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-native-controller]")).toHaveCount(0);
      await click(button("設定を閉じる"));
      await click(button("添付とその他の操作"));
      await click(button("スタンプと絵文字"));
      const sticker = button("サンプル太陽");
      await expect(sticker).toBeAttached();
      const stickerBounds = await sticker.boundingBox(); assert(stickerBounds);
      await page.mouse.click(stickerBounds.x + stickerBounds.width / 2, stickerBounds.y + stickerBounds.height / 2, { button: "right" });
      await click(button("＋ 組み合わせに追加"));
      const sourceX = page.locator('[data-native-controller] [data-native-combo-x]').first();
      await expect(sourceX).toBeAttached();
      const beforeX = Number(await sourceX.inputValue());
      const move = frame.getByLabel("サンプル太陽の位置を変更", { exact: true });
      await expect(move).toBeAttached();
      const moveBounds = await settledBounds(move);
      await page.mouse.move(moveBounds.x + 20, moveBounds.y + 20); await page.mouse.down();
      await page.mouse.move(moveBounds.x + 75, moveBounds.y + 40, { steps: 12 }); await page.mouse.up();
      await expect.poll(async () => Number(await sourceX.inputValue()), { message: `${mode}: native sticker drag updates controller x` }).toBeGreaterThan(beforeX);
      const sourceSize = page.locator('[data-native-controller] [data-native-combo-size]').first();
      const beforeSize = Number(await sourceSize.inputValue());
      const resizeBounds = await settledBounds(frame.getByLabel("サンプル太陽のサイズを変更", { exact: true }));
      console.log(`${mode}: sticker move=${JSON.stringify(moveBounds)}, resize=${JSON.stringify(resizeBounds)}, x=${await sourceX.inputValue()}`);
      await page.mouse.move(resizeBounds.x + 20, resizeBounds.y + 20); await page.mouse.down();
      await page.mouse.move(resizeBounds.x + 55, resizeBounds.y + 55, { steps: 10 }); await page.mouse.up();
      await expect.poll(async () => Number(await sourceSize.inputValue()), { message: `${mode}: native sticker resize updates controller size` }).toBeGreaterThan(beforeSize);
      await page.screenshot({ path: `${output}/${mode}-sticker-combination.png` });
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-native-controller]")).toHaveCount(0);
      assert.deepEqual(errors, []);
      results.push({ mode, nativeCreate: true, inputController: true, nativeTools: true, nativeSettings: true, stickerContextAndDragResize: true, noVisibleLegacyDialog: true });
      console.log(`${mode}: native specialist panels PASS`);
    } catch (error) {
      await page.screenshot({ path: `${output}/${mode}-failure.png` });
      const frame = page.frames().find((frame) => frame.url().includes("ui-compose"));
      await writeFile(`${output}/${mode}-failure.json`, JSON.stringify({ errors, semantics: await frame?.locator("body").ariaSnapshot(), controllers: await page.locator("[data-native-controller]").count() }, null, 2));
      throw error;
    } finally { await page.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
