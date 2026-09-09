import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect, type Locator } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5186";
const output = `test-results/native-settings-layout/${Date.now()}`;
await mkdir(output, { recursive: true });
console.log(`Artifacts: ${output}`);
const browser = await chromium.launch({ headless: true });
const results: object[] = [];
try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith("/api/")) {
        const accountId = url.pathname.split("/")[3];
        return route.fulfill({ json: { ok: true, items: [], devices: [], accounts: [], sessions: [],
          storage: { accountId, usedBytes: 400000000, limitBytes: 10000000000, remainingBytes: 9600000000,
            historyBytes: 100000000, mediaBytes: 300000000, backupBytes: 0, recordingBytes: 0 } } });
      }
      return route.continue();
    });
    await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 })), mode);
    await page.goto(`${base}/pr-demo?stress=80`);
    await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
    const frame = page.frames().find(frame => frame.url().includes("ui-compose"))!;
    const button = (name: string) => frame.getByRole("button", { name, exact: true });
    const tap = async (locator: Locator) => {
      await expect(locator).toBeAttached();
      // The accessibility mirror updates after native layout. Wait for it before aiming.
      await page.waitForTimeout(1100);
      let previous = "";
      let box = await locator.boundingBox();
      await expect.poll(async () => {
        box = await locator.boundingBox();
        const current = JSON.stringify(box);
        const stable = box !== null && previous === current;
        previous = current;
        return stable;
      }, { intervals: [200, 300, 500] }).toBe(true);
      assert(box);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    try {
      for (const viewport of [{ width: 1920, height: 1000 }, { width: 390, height: 1000 }, { width: 390, height: 480 }]) {
        const { width, height } = viewport;
        await page.setViewportSize(viewport);
        await page.waitForTimeout(1300);
        const plus = await button("添付とその他の操作").boundingBox(); assert(plus);
        await tap(button("添付とその他の操作"));
        await expect(button("写真・動画")).toBeAttached();
        await page.waitForTimeout(1300);
        const first = await button("写真・動画").boundingBox(); assert(first);
        assert(first.x >= 0 && first.x + first.width <= width + 1 && first.y >= 0, `${mode}: menu inside ${width}`);
        if (mode === "apple") {
          const close = await button("閉じる").boundingBox(); assert(close);
          assert(Math.abs(close.x - plus.x) < 2 && Math.abs(close.y - plus.y) < 2, "close replaces plus");
        }
        await page.screenshot({ path: `${output}/${mode}-${width}x${height}-plus.png` });
        await page.keyboard.press("Escape");
        await expect(button("写真・動画")).toHaveCount(0);
        await page.mouse.move(width - 80, height / 2); await page.mouse.wheel(0, -700);
        await expect(button("最新のメッセージへ")).toBeAttached();
        await page.waitForTimeout(1100);
        await page.screenshot({ path: `${output}/${mode}-${width}x${height}-jump.png` });
        await tap(button("最新のメッセージへ"));
      }
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.evaluate(async () => {
        const resources = performance.getEntriesByType("resource").map(entry => entry.name);
        const storePath = resources.findLast(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!;
        const authPath = resources.findLast(url => /\/src\/stores\/authStore\.ts(?:\?|$)/.test(url))!;
        const { useStore } = await import(storePath);
        const { useAuthStore } = await import(authPath);
        useStore.setState({ accountId: "demo" });
        useAuthStore.setState({ accounts: ["demo", "second"], saved: [], sessions: [
          { accountId: "demo", displayName: "メインアカウント", hasToken: true },
          { accountId: "second", displayName: "サブアカウント", hasToken: true },
        ] });
      });
      await tap(button("設定").first());
      const advanced = button("アカウント・バックアップ・詳細設定");
      await expect(advanced).toBeAttached();
      await page.mouse.move(1400, 700); await page.mouse.wheel(0, 1000);
      await tap(advanced);
      const tab = (name: string) => frame.getByRole("tab", { name, exact: true });
      await tap(tab("外観・UI"));
      await expect(frame.getByRole("radio")).toHaveCount(8);
      await expect(frame.getByRole("switch")).toHaveCount(0);
      const choices = page.locator("[data-native-controller] fieldset").first();
      await choices.evaluate(node => node.setAttribute("disabled", ""));
      await expect(frame.getByRole("radio").first()).toHaveAttribute("aria-disabled", "true");
      await choices.evaluate(node => node.removeAttribute("disabled"));
      await expect(frame.getByRole("radio").first()).not.toHaveAttribute("aria-disabled", "true");
      await tap(frame.getByRole("radio", { name: "ライト", exact: true }));
      await expect(frame.getByRole("radio", { name: "ライト", exact: true })).toHaveAttribute("aria-checked", "true");
      await tap(frame.getByRole("radio", { name: "ダーク", exact: true }));
      await expect(frame.getByRole("radio", { name: "ダーク", exact: true })).toHaveAttribute("aria-checked", "true");
      await expect(frame.getByText("チャットに戻る", { exact: true })).toHaveCount(0);
      await page.screenshot({ path: `${output}/${mode}-appearance.png` });
      await tap(tab("サブデバイス"));
      await expect(button("QRを表示")).toBeAttached();
      const heading = frame.getByRole("heading", { name: "サブデバイス", exact: true });
      await expect(heading).toBeAttached();
      await page.waitForTimeout(1200);
      assert((await heading.boundingBox())!.y < 160, "category starts at top after navigation");
      const qr = await button("QRを表示").boundingBox(); assert(qr && qr.width < 200);
      await page.screenshot({ path: `${output}/${mode}-subdevices.png` });
      await tap(button("QRを表示"));
      await expect(frame.getByRole("button", { name: "サブデバイス接続用QRコード", exact: true })).toBeAttached();
      await tap(tab("ストレージ"));
      await expect(frame.getByRole("progressbar").first()).toBeAttached();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${output}/${mode}-storage.png` });
      await tap(button("メインアカウント"));
      await expect(button("サブアカウント")).toBeAttached();
      await expect(button("メインアカウント")).toContainText("使用中 · demo");
      await expect(button("サブアカウント")).toContainText("切り替える · second");
      await expect(button("アカウントを追加")).toBeAttached();
      await expect(button("ログアウト")).toBeAttached();
      await page.screenshot({ path: `${output}/${mode}-accounts.png` });
      await tap(tab("詳細・復元"));
      await expect(tab("詳細・復元")).toHaveAttribute("aria-selected", "true");
      await expect(button("キャッシュを削除して再読み込み")).toBeAttached();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(1300);
      const cache = await button("キャッシュを削除して再読み込み").boundingBox();
      assert(cache && cache.x >= 0 && cache.x + cache.width <= 391, "mobile cache action fits");
      await page.screenshot({ path: `${output}/${mode}-mobile.png` });
      assert.deepEqual(errors, []);
      results.push({ mode, menuWidths: [1920, 390], categories: ["theme", "subdevices", "storage", "accounts", "advanced"], errors });
      console.log(`${mode}: menu boundaries and settings layouts passed`);
    } catch (error) {
      await page.screenshot({ path: `${output}/${mode}-failure.png` });
      await writeFile(`${output}/${mode}-failure.txt`, await frame.locator("body").innerText());
      throw error;
    } finally { await page.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
