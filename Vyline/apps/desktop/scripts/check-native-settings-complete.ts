import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium, expect, type Locator } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5186";
const output = `test-results/native-settings-complete/${Date.now()}-${process.env.VYLINE_TEST_MODES?.replaceAll(",", "-") ?? "all"}`;
await mkdir(output, { recursive: true });
console.log(`Artifacts: ${output}`);
const photo = await readFile("public/share-cafe.png");
const categories = ["プロフィール", "既読", "表示", "外観・UI", "通知", "プライバシー", "詳細・復元", "サブデバイス", "ストレージ", "通話記録", "プラグイン", "ベータ機能", "引継ぎ・診断", "情報"];
const testedCategories = process.env.VYLINE_TEST_CATEGORIES?.split(",") ?? categories;
const browser = await chromium.launch({ headless: true });
const results: object[] = [];
try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.request().resourceType() === "image" || /\.png|unavatar/.test(url.href)
        ? route.fulfill({ body: photo, contentType: "image/png", headers: { "access-control-allow-origin": "*" } }) : route.abort();
      if (url.pathname.startsWith("/api/")) {
        let body: object = { ok: true, items: [], devices: [], results: [], profiles: {}, plugins: [{ id: "sample", name: "表示確認プラグイン", version: "1.0", description: "長い説明と有効状態の表示確認", enabled: true, active: true, loadable: true }], backups: [1, 2].map(index => ({ id: `backup-${index}`, createdAt: Date.now(), chatCount: 2, messageCount: 24, sizeBytes: 500000, includeMedia: true })), logs: [], accounts: [], sessions: [] };
        if (/recordings\/settings$/.test(url.pathname)) body = { ok: true, preferences: { automatic: false, kind: "audio", retentionDays: 30, targetId: null, consentAccepted: false }, targets: [{ id: "disk", name: "テスト保存先", path: "/recordings", kind: "local" }], roots: [], credentialProtection: "test" };
        else if (/\/recordings$/.test(url.pathname)) body = { ok: true, items: [1, 2].map(index => ({ id: `record-${index}`, title: `保存した音声 ${index}`, state: "ready", kind: "audio", createdAt: Date.now(), durationMs: 12000, bytes: 1000000, expiresAt: null, targetId: null, transfer: null })), nextCursor: null };
        else if (/ios-backups$/.test(url.pathname)) body = { ok: true, devices: [{ name: "テスト iPhone", udid: "test-device-1" }, { name: "もう一台の iPhone", udid: "test-device-2" }] };
        else if (/backup-storage/.test(url.pathname)) body = { ok: true, storage: { accountId: "demo", usedBytes: 400000000, limitBytes: 10000000000, remainingBytes: 9600000000, historyBytes: 100000000, mediaBytes: 300000000, backupBytes: 0 } };
        return route.fulfill({ json: body });
      }
      return route.continue();
    });
    await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 })), mode);
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
      const frame = page.frames().find(frame => frame.url().includes("ui-compose"))!;
      const button = (name: string) => frame.getByRole("button", { name, exact: true });
      let inPanel = false;
      const scrollContent = async (delta: number) => {
        const box = await frame.getByRole("list").last().boundingBox(); assert(box);
        await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
        await page.mouse.wheel(0, delta);
      };
      const click = async (locator: Locator, scrollX?: number) => {
        await expect(locator).toBeAttached();
        for (let attempt = 0; attempt < 5; attempt++) {
          await page.waitForTimeout(1200);
          const box = await locator.boundingBox(); assert(box);
          const height = page.viewportSize()!.height;
          if (box.width > 0 && box.height > 0 && (box.y >= 90 && box.y + box.height <= height - 5 || scrollX === undefined)) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); return;
          }
          const delta = box.height > 0 && box.y < 90 ? -500 : 500;
          if (inPanel && (scrollX ?? 950) > page.viewportSize()!.width / 2) await scrollContent(delta);
          else { await page.mouse.move(scrollX ?? 950, height / 2); await page.mouse.wheel(0, delta); }
        }
        throw new Error(`Control not reachable: ${await locator.innerText()}`);
      };
      await page.evaluate(async () => {
        const urls = performance.getEntriesByType("resource").map(entry => entry.name);
        const { useStore } = await import(urls.findLast(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!);
        const { useAuthStore } = await import(urls.findLast(url => /\/src\/stores\/authStore\.ts(?:\?|$)/.test(url))!);
        const photo = new URL("/share-cafe.png", location.href).href;
        useStore.setState({ accountId: "demo", self: { ...useStore.getState().self, name: "画像付きプロフィール", avatarUrl: photo, backgroundUrl: new URL("/share-sunset.png", location.href).href }, readDisabledMids: { [useStore.getState().chats[0].id]: true } });
        useAuthStore.setState({ accounts: ["demo"], saved: [], sessions: [{ accountId: "demo", displayName: "画像付きプロフィール", hasToken: true, picturePath: photo }] });
      });
      await click(button("設定").first());
      await click(button("アカウント・バックアップ・詳細設定"), 950);
      inPanel = true;
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(1300);
        let current = width === 1280 ? "既読" : testedCategories.at(-1)!;
        for (const category of testedCategories) {
          const index = categories.indexOf(category);
          if (width < 760) await click(button(current).first());
          const tab = frame.getByRole("tab", { name: category, exact: true });
          await click(tab, width < 760 ? 90 : 190);
          if (width >= 760) await expect(tab).toHaveAttribute("aria-selected", "true");
          current = category;
          await page.waitForTimeout(1400);
          const name = `${mode}-${width}-${index.toString().padStart(2, "0")}`;
          await page.screenshot({ path: `${output}/${name}-top.png` });
          const overflow = await frame.locator("[role],p").evaluateAll(nodes => nodes.filter(node => {
            const box = node.getBoundingClientRect();
            return box.width > 0 && box.y > 90 && box.y < innerHeight && (box.left < -1 || box.right > innerWidth + 1);
          }).map(node => ({ text: node.textContent?.slice(0, 100), rect: node.getBoundingClientRect().toJSON() })));
          assert.deepEqual(overflow, [], `${mode}/${width}/${category}: horizontal bounds`);
          if (category === "プロフィール") {
            await expect(button("アイコンを変更")).toBeAttached();
            await expect(button("背景を変更")).toBeAttached();
            assert((await frame.getByRole("textbox", { name: "表示名", exact: true }).boundingBox())!.y < 650, "profile form remains near avatar");
            const avatar = await frame.getByRole("img", { name: "画像付きプロフィールのアイコン", exact: true }).boundingBox();
            assert(avatar && avatar.width <= 100 && avatar.height <= 100, "avatar is compact");
            const fileChooser = page.waitForEvent("filechooser");
            await click(button("アイコンを変更"));
            await (await fileChooser).setFiles("public/share-cafe.png");
            await expect.poll(() => page.locator('[data-native-controller] [data-native-kind="profile-summary"]').getAttribute("data-native-image-url")).toMatch(/^blob:/);
          }
          if (category === "ベータ機能") {
            await expect(frame.getByRole("switch")).toHaveCount(4);
            await expect(frame.getByText("プロフィールのブロック確認", { exact: true })).toHaveCount(0);
          }
          if (category === "情報") {
            const github = await button("GitHub").boundingBox(); assert(github && github.height < 90 && github.x >= 0 && github.x + github.width <= width);
            await expect(button("GitHub")).toContainText("tqmane");
          }
          await scrollContent(6000);
          await page.waitForTimeout(1400);
          await page.screenshot({ path: `${output}/${name}-bottom.png` });
          if (category === "表示") {
            const slider = frame.getByRole("slider", { name: "文字サイズ", exact: true }).first();
            const bounds = await slider.boundingBox(); assert(bounds && bounds.height >= 30);
            if (mode === "apple") {
              const pixels = await page.screenshot({ clip: bounds });
              const whiteRatio = await page.evaluate(async (data) => {
                const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
                const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
                const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
                const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
                let white = 0; for (let offset = 0; offset < rgba.length; offset += 4) if (rgba[offset]! > 225 && rgba[offset + 1]! > 225 && rgba[offset + 2]! > 225) white++;
                return white / (rgba.length / 4);
              }, pixels.toString("base64"));
              assert(whiteRatio > .002 && whiteRatio < .2, `Apple slider has a small white thumb, not a white bar: ${whiteRatio}`);
            }
            const source = page.locator('[data-native-controller] input[type="range"]').first();
            const before = Number(await source.inputValue());
            const moveSlider = async (fraction: number) => {
              const current = Number(await source.inputValue());
              const min = Number(await source.getAttribute("min")); const max = Number(await source.getAttribute("max"));
              await page.mouse.move(bounds.x + bounds.width * ((current - min) / (max - min)), bounds.y + bounds.height / 2);
              await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * fraction, bounds.y + bounds.height / 2, { steps: 12 }); await page.mouse.up();
            };
            await moveSlider(.8);
            await expect.poll(async () => Number(await source.inputValue())).toBeGreaterThan(before);
            await moveSlider(.375);
            await expect.poll(async () => Number(await source.inputValue())).toBeCloseTo(1, 2);
          }
          if (category === "通話記録") {
            await scrollContent(-6000); await page.waitForTimeout(1300);
            const settings = button("保存期間・自動記録・保存先");
            await click(settings, width - 60);
            await page.waitForTimeout(1300);
            await page.screenshot({ path: `${output}/${name}-settings.png` });
            await expect(frame.getByText("記録形式", { exact: true })).toHaveCount(1);
            await click(button("保存先を追加"), width - 60);
            await page.waitForTimeout(1200);
            await expect(frame.getByRole("textbox", { name: "サーバー内の絶対パス", exact: true })).toHaveCount(1);
            await page.screenshot({ path: `${output}/${name}-add-target.png` });
          }
          results.push({ mode, width, category, screenshots: [`${name}-top.png`, `${name}-bottom.png`] });
          console.log(`${mode} ${width}: ${category}`);
        }
      }
      assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: `${output}/${mode}-failure.png` });
      const frame = page.frames().find(frame => frame.url().includes("ui-compose"));
      if (frame) await writeFile(`${output}/${mode}-failure.txt`, await frame.locator("body").ariaSnapshot());
      throw error;
    } finally { await page.close(); }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
