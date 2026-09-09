import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect, type Locator } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5186";
const output = `test-results/native-call/${Date.now()}`;
await mkdir(output, { recursive: true });
console.log(`Artifacts: ${output}`);
const browser = await chromium.launch({ headless: true });
const results: object[] = [];
try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      (window as any).__callKeys = [];
      window.addEventListener("keydown", (event) => { if (event.key === "Escape") (window as any).__callKeys.push({ target: (event.target as Element)?.tagName, prevented: event.defaultPrevented }); }, true);
    });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith("/api/"))
        return route.fulfill({
          json: { ok: true, chats: [], members: [], results: [], items: [] },
        });
      return route.continue();
    });
    await page.addInitScript(
      (mode) =>
        localStorage.setItem(
          "vyline:design-system",
          JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 }),
        ),
      mode,
    );
    let height = 667;
    const click = async (locator: Locator) => {
      await expect(locator).toBeAttached();
      let last = "";
      let settled: { x: number; y: number; width: number; height: number } | null = null;
      await expect
        .poll(async () => {
          const box = await locator.boundingBox();
          const value = JSON.stringify(box);
          const ready = box && box.y >= 0 && box.y + box.height <= height && value === last;
          if (ready) settled = box;
          last = value;
          return !!ready;
        })
        .toBe(true);
      const box = settled;
      assert(box);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
      const frame = page.frames().find((frame) => frame.url().includes("ui-compose"))!;
      const button = (name: string) => frame.getByRole("button", { name, exact: true });
      const scrollTo = async (locator: Locator) => {
        for (let attempt = 0; attempt < 12; attempt++) {
          const box = await locator.count() ? await locator.boundingBox() : null;
          if (box && box.y > 80 && box.y + box.height < height - 100) return;
          await page.mouse.move((page.viewportSize()?.width ?? 375) - 150, height / 2);
          await page.mouse.wheel(0, 400);
          await page.waitForTimeout(150);
        }
        throw new Error("Call body control was not reachable by scrolling");
      };
      const read = async () =>
        JSON.parse((await page.locator("[data-call-fixture] output").textContent()) ?? "{}");
      const mount = async (scenario: string) =>
        page.evaluate(async (scenario) => {
          const load = (path: string) => import(path);
          const React = (await load("/node_modules/.vite/deps/react.js")).default;
          const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js"))
            .default;
          const { CallLayoutFixture } = await load("/scripts/call-layout-fixture.tsx");
          const target = window as any;
          if (!target.__callRoot) {
            const node = document.createElement("div");
            document.body.append(node);
            target.__callRoot = createRoot(node);
          }
          target.__callGeneration = (target.__callGeneration ?? 0) + 1;
          target.__callRoot.render(
            React.createElement(CallLayoutFixture, {
              native: true,
              scenario,
              key: `${scenario}-${target.__callGeneration}`,
            }),
          );
        }, scenario);
      for (const [width, h] of process.argv.includes("--desktop-only") ? [[1440, 900]] : [
        [375, 667],
        [667, 375],
        [1440, 900],
      ]) {
        height = h!;
        await page.setViewportSize({ width: width!, height });
        for (const scenario of ["voice", "video", "group", "group-video", "camera-unavailable", "failed"]) {
          await mount(scenario);
          const endLabel = scenario === "failed" ? "通話画面を閉じる" : "通話を終了";
          await expect(button(endLabel)).toBeAttached();
          await expect
            .poll(
              async () => {
                const box = await button(endLabel).boundingBox();
                return !!box && box.y >= 0 && box.y + box.height <= height;
              },
              { message: "Hangup must be available without scrolling" },
            )
            .toBe(true);
          await click(button("ミュート"));
          await expect.poll(async () => (await read()).muted).toBe(true);
          await click(button("ミュート解除"));
          await expect.poll(async () => (await read()).muted).toBe(false);
          if (scenario === "camera-unavailable")
            await expect(button("カメラを開始してビデオ通話に切り替え")).toHaveAttribute(
              "aria-disabled",
              "true",
            );
          if (scenario === "voice") {
            await click(button("カメラを開始してビデオ通話に切り替え"));
            await expect.poll(async () => (await read()).camera).toBe(true);
            await click(button("前後のカメラを切り替え"));
            await expect.poll(async () => (await read()).switches).toBe(1);
            if (width === 375) {
              const stage = frame.locator("[data-call-stage]");
              await expect(stage).toBeVisible();
              const stageBounds = await stage.boundingBox(); assert(stageBounds);
              const touch = await page.context().newCDPSession(page);
              const x = stageBounds.x + 30;
              const y = stageBounds.y + 60;
              await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
              for (let step = 1; step <= 8; step++) {
                await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 12 }] });
                await page.waitForTimeout(16);
              }
              await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
              await touch.detach();
              await expect.poll(async () => !(await stage.count()) || (await stage.boundingBox())!.y < stageBounds.y - 20,
                { message: "Vertical touch over media scrolls the native call body" }).toBe(true);
              await scrollTo(button("録音・録画"));
              await click(button("録音・録画"));
              await scrollTo(button("録音を開始"));
              await click(button("録音を開始"));
              await expect.poll(async () => (await read()).recordingState).toBe("recording");
              await scrollTo(button("記録を停止"));
              await click(button("記録を停止"));
              await expect.poll(async () => (await read()).recordingState).toBe("saved");
            }
          }
          if (width === 1440) {
            const separator = frame.getByLabel("通話ペインの幅を調整", { exact: true });
            await expect(separator).toBeAttached();
            const original = await separator.boundingBox();
            assert(original);
            await page.mouse.move(original.x + original.width / 2, original.y + 100);
            await page.mouse.down();
            await page.mouse.move(original.x - 60, original.y + 100, { steps: 10 });
            await page.mouse.up();
            await expect
              .poll(async () => Number(await page.locator("[data-native-call-width]").inputValue()))
              .toBeGreaterThan(420);
            if (scenario === "voice") {
              const field = page.locator("[data-native-call-width]");
              const before = Number(await field.inputValue());
              await expect(separator).toHaveAttribute("aria-description", String(Math.trunc(before)));
              await click(separator); await page.keyboard.press("ArrowLeft");
              await expect.poll(async () => Number(await field.inputValue())).toBeGreaterThan(before + 20);
              await page.keyboard.press("Home"); await expect.poll(async () => Number(await field.inputValue())).toBe(320);
              await page.keyboard.press("End"); await expect.poll(async () => Number(await field.inputValue())).toBe(Number(await field.getAttribute("max")));
              await expect(separator).toHaveAttribute("aria-description", String(await field.getAttribute("max")));
              const reset = await separator.boundingBox(); assert(reset);
              // Compose recognizes timed taps, not the DOM MouseEvent.detail shortcut.
              await page.mouse.click(reset.x + reset.width / 2, reset.y + reset.height / 2);
              await page.waitForTimeout(90);
              await page.mouse.click(reset.x + reset.width / 2, reset.y + reset.height / 2);
              await expect.poll(async () => Number(await field.inputValue())).toBe(400);
            }
          }
          await page.screenshot({ path: `${output}/${mode}-${width}-${scenario}.png` });
          if (width === 375 && scenario === "voice") await page.keyboard.press("Escape");
          else await click(button("トークを見る"));
          await expect(button("通話へ戻る")).toBeAttached();
          await expect(frame.getByRole("textbox", { name: "メッセージを入力", exact: true })).toBeAttached();
          await expect.poll(async () => (await read()).closed).toBe(false);
          if (width === 1440 && scenario === "voice") {
            await click(button("グループを作成").first());
            const groupName = frame.getByRole("textbox", { name: "グループ名（任意）", exact: true });
            await expect(groupName).toBeAttached();
            await expect(button("通話へ戻る")).toBeAttached();
            await expect(button(endLabel)).toBeAttached();
            await click(groupName); await page.keyboard.press("Escape");
            await expect(groupName).toHaveCount(0);
          }
          await click(button("通話へ戻る"));
          await expect(button("通話へ戻る")).toHaveCount(0);
          await expect(button("トークを見る")).toBeAttached();
          await expect(button(endLabel)).toBeAttached();
          await click(button(endLabel));
          await expect
            .poll(async () => (await read()).closed, {
              message: `${mode}/${width}/${scenario}: explicit hangup reaches call controller`,
            })
            .toBe(true);
          results.push({ mode, width, height, scenario, fixedControls: true });
        }
      }
      await click(button("グループを作成").first());
      await expect(
        frame.getByRole("textbox", { name: "グループ名（任意）", exact: true }),
      ).toBeAttached();
      await page.evaluate(async () => {
        const path = "/src/lib/store.ts";
        const { useStore } = await import(path);
        useStore.setState({
          chats: [...useStore.getState().chats, { id: `u${"3".repeat(32)}`, type: "friend", name: "画像付きの着信検証", avatar: "着", color: "#7292A9", avatarUrl: "/demo/sticker-heart.svg", unread: 0 }],
          incomingCall: {
            callMid: "fixture-incoming",
            chatMid: `u${"3".repeat(32)}`,
            callerMid: `u${"3".repeat(32)}`,
            callType: "video",
            receivedAt: Date.now(),
          },
        });
      });
      await expect(button("応答")).toBeAttached();
      await page.screenshot({ path: `${output}/${mode}-incoming-over-settings.png` });
      await click(button("着信通知を閉じる"));
      await expect(button("応答")).toHaveCount(0);
      await expect(
        frame.getByRole("textbox", { name: "グループ名（任意）", exact: true }),
      ).toBeAttached();
      assert.deepEqual(errors, []);
      console.log(
        `${mode}: native call controls, docking, resize, minimize and unavailable-camera states PASS`,
      );
    } catch (error) {
      await page.screenshot({ path: `${output}/${mode}-failure.png` });
      const frame = page.frames().find((frame) => frame.url().includes("ui-compose"));
      await writeFile(
        `${output}/${mode}-failure.json`,
        JSON.stringify(
          {
            errors,
            keys: { host: await page.evaluate(() => (window as any).__callKeys), frame: await frame?.evaluate(() => (window as any).__callKeys) },
            semantics: await frame?.locator("body").ariaSnapshot(),
            source: await page.locator("[data-call-fixture] output").textContent(),
            panel: await page.locator("[data-call-panel]").getAttribute("data-call-panel"),
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await page.close();
    }
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
