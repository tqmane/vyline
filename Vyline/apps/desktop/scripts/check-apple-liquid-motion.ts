import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const production = process.argv.includes("--production");
const output = resolve(
  import.meta.dir,
  `../test-results/apple-liquid-motion${production ? "-production" : ""}`,
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];

async function bounds(locator: Locator) {
  await expect(locator).toBeAttached();
  let previous = "";
  await expect
    .poll(
      async () => {
        const next = JSON.stringify(await locator.boundingBox());
        const stable = next !== "null" && next === previous;
        previous = next;
        return stable;
      },
      { intervals: [100] },
    )
    .toBe(true);
  const b = await locator.boundingBox();
  assert(b && b.width > 0 && b.height > 0);
  return b;
}
async function click(page: Page, locator: Locator) {
  const b = await bounds(locator);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
// Decode the actual screenshot in an off-DOM browser canvas; no image dependency
// or application instrumentation is required to prove rendered pixels changed.
async function pixelDifference(page: Page, before: Buffer, after: Buffer, threshold = 8) {
  return page.evaluate(
    async ({ first, second, threshold }) => {
      const pixels = async (value: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${value}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [a, b] = await Promise.all([pixels(first), pixels(second)]);
      if (a.length !== b.length) throw new Error("Crops must have the same dimensions");
      let changed = 0;
      for (let i = 0; i < a.length; i += 4)
        if (
          Math.max(
            Math.abs(a[i] - b[i]),
            Math.abs(a[i + 1] - b[i + 1]),
            Math.abs(a[i + 2] - b[i + 2]),
          ) > threshold
        )
          changed++;
      return { changed, ratio: changed / (a.length / 4), threshold };
    },
    { first: before.toString("base64"), second: after.toString("base64"), threshold },
  );
}

try {
  for (const appearance of ["light", "dark"] as const) {
    for (const reduced of [false, true]) {
      const name = `${appearance}-${reduced ? "reduced" : "spring"}`;
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        reducedMotion: reduced ? "reduce" : "no-preference",
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/"))
          return route.abort();
        return route.continue();
      });
      await page.addInitScript((appearance) => {
        if (top === window)
          localStorage.setItem(
            "vyline:design-system",
            JSON.stringify({ state: { mode: "apple", appearance }, version: 0 }),
          );
        (window as any).liquidProbe = { actions: [], tab: "all", reducedMotion: false };
        addEventListener("message", (event) => {
          let data = event.data;
          if (typeof data === "string") {
            try {
              data = JSON.parse(data);
            } catch {
              return;
            }
          }
          if (data?.channel !== "vyline-ui") return;
          if (data.type === "action")
            (window as any).liquidProbe.actions.push({ action: data.action, id: data.id });
          if (data.tab !== undefined) (window as any).liquidProbe.tab = data.tab;
          if (data.reducedMotion !== undefined)
            (window as any).liquidProbe.reducedMotion = data.reducedMotion;
        });
      }, appearance);
      try {
        await page.goto(`${base}/pr-demo`);
        await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
        await expect(
          page.getByText("DEMO MODE ON · 仮データのみ · 実アカウント接続なし", { exact: true }),
        ).toBeVisible();
        await page.evaluate(async (production) => {
          const url = performance
            .getEntriesByType("resource")
            .find((e) => new URL(e.name).pathname === "/src/lib/store.ts")?.name;
          // Production has no importable Vite store. It runs the same PrDemoPage
          // in a fresh browser context, with every API/remote request blocked above.
          if (!url && production) return;
          if (!url) throw new Error("Vite store not found");
          const { useStore } = await import(url);
          if (!useStore.getState().demoMode || useStore.getState().accountId !== null)
            throw new Error("Account-free demo required");
        }, production);
        const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
        const frame = page.frames().find((f) => f.url().includes("/ui-compose/"))!;
        const button = (label: string) => native.getByRole("button", { name: label, exact: true });
        await expect
          .poll(() => frame.evaluate(() => (window as any).liquidProbe.reducedMotion))
          .toBe(reduced);
        await click(page, button("トーク一覧に戻る"));
        const edit = button("編集");
        const b = await bounds(edit);
        const clip = {
          x: Math.max(0, Math.floor(b.x - 14)),
          y: Math.max(24, Math.floor(b.y - 14)),
          width: Math.ceil(b.width + 28),
          height: Math.ceil(b.height + 28),
        };
        const capture = (stage: string) =>
          page.screenshot({ path: resolve(output, `${name}-${stage}.png`), clip });
        await page.waitForTimeout(800);
        const idle = await capture("idle");
        await page.waitForTimeout(100);
        assert.ok(
          (await pixelDifference(page, idle, await capture("idle-repeat"))).ratio < 0.01,
          "Idle backdrop must be stable",
        );
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.waitForTimeout(45);
        const pressStart = await capture("press-start");
        await page.waitForTimeout(180);
        const pressed = await capture("pressed");
        // Reduced motion keeps geometry fixed. Its white highlight over the light
        // surface changes channels by only 1–3, measured from the rendered PNGs.
        const pressChange = await pixelDifference(page, idle, pressed, reduced ? 0 : 8);
        assert.ok(
          pressChange.changed > 40,
          `Actual glass press must render: ${JSON.stringify(pressChange)}`,
        );
        const springFrames = await pixelDifference(page, pressStart, pressed, reduced ? 0 : 8);
        if (!reduced)
          assert.ok(springFrames.changed > 10, "Spring must produce distinct intermediate frames");
        else assert.ok(springFrames.ratio < 0.01, "Reduced motion has immediate, stable feedback");
        await page.mouse.move(x + 18, y + 8, { steps: 6 });
        await page.waitForTimeout(120);
        const dragged = await capture("dragged");
        const dragChange = await pixelDifference(page, pressed, dragged);
        if (!reduced) assert.ok(dragChange.changed > 20, "Drag must alter the drawn glass layer");
        await page.mouse.move(x + 140, y + 100, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(900);
        const settled = await capture("settled");
        await expect(edit).toBeAttached();
        const returnChange = await pixelDifference(page, idle, settled, reduced ? 0 : 8);
        assert.ok(
          returnChange.ratio < 0.02,
          `Cancelled press must return to rest: ${JSON.stringify(returnChange)}`,
        );

        // Keyboard follows the same InteractionSource while preserving normal activation.
        await click(page, edit);
        await expect(button("完了")).toBeAttached();
        await page.waitForTimeout(700);
        const keyIdle = await capture("keyboard-idle");
        await page.keyboard.down("Space");
        await page.waitForTimeout(180);
        const keyPressed = await capture("keyboard-pressed");
        assert.ok(
          (await pixelDifference(page, keyIdle, keyPressed, reduced ? 0 : 8)).changed > 40,
          "Keyboard press must animate the same glass",
        );
        await page.keyboard.up("Space");
        await expect(edit).toBeAttached();

        const client = await page.context().newCDPSession(page);
        await page.waitForTimeout(800);
        await frame.evaluate(() => {
          (window as any).touchEvents = [];
          for (const name of [
            "pointerdown",
            "pointerup",
            "pointercancel",
            "touchstart",
            "touchend",
            "touchcancel",
          ])
            addEventListener(
              name,
              (event) =>
                (window as any).touchEvents.push({
                  type: event.type,
                  target: (event.composedPath()[0] as HTMLElement).tagName,
                  pointerType: (event as PointerEvent).pointerType,
                  x: (event as PointerEvent).clientX,
                  y: (event as PointerEvent).clientY,
                }),
              true,
            );
        });
        const touchBounds = await bounds(edit);
        // Keep the mouse hovering over the same control: Compose 1.12 used to
        // include that idle mouse in touchdown and reject the entire gesture.
        await page.mouse.move(
          touchBounds.x + touchBounds.width / 2,
          touchBounds.y + touchBounds.height / 2,
        );
        const touchIdle = await capture("touch-idle");
        await client.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            { x: touchBounds.x + touchBounds.width / 2, y: touchBounds.y + touchBounds.height / 2 },
          ],
        });
        await page.waitForTimeout(180);
        const touchPressed = await capture("touch-pressed");
        const touchChange = await pixelDifference(page, touchIdle, touchPressed, reduced ? 0 : 8);
        assert.ok(
          touchChange.changed > 40,
          `Touch press must draw the glass feedback: ${JSON.stringify({ touchChange, touchBounds, events: await frame.evaluate(() => (window as any).touchEvents) })}`,
        );
        await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        await page.waitForTimeout(800);
        await expect(edit).toBeAttached();
        await page.touchscreen.tap(
          touchBounds.x + touchBounds.width / 2,
          touchBounds.y + touchBounds.height / 2,
        );
        await expect(button("完了")).toBeAttached();
        await page.touchscreen.tap(
          touchBounds.x + touchBounds.width / 2,
          touchBounds.y + touchBounds.height / 2,
        );
        await expect(edit).toBeAttached();

        await click(page, button("トークのフィルタ"));
        const all = await bounds(button("全体"));
        const group = await bounds(button("グループ"));
        const tabsClip = { x: 8, y: Math.floor(all.y - 12), width: 374, height: 76 };
        await page.waitForTimeout(700);
        const tabsIdle = await page.screenshot({
          path: resolve(output, `${name}-tabs-idle.png`),
          clip: tabsClip,
        });
        await page.mouse.move(all.x + all.width / 2, all.y + all.height / 2);
        await page.mouse.down();
        await page.mouse.move(group.x + group.width / 2, group.y + group.height / 2, { steps: 16 });
        await page.waitForTimeout(180);
        const tabsDragging = await page.screenshot({
          path: resolve(output, `${name}-tabs-dragging.png`),
          clip: tabsClip,
        });
        await page.mouse.up();
        await expect
          .poll(() => frame.evaluate(() => (window as any).liquidProbe.tab))
          .toBe("group");
        const tabsChange = await pixelDifference(page, tabsIdle, tabsDragging);
        assert.ok(tabsChange.changed > 80, "Moving optical tab pill must be visible");
        await page.waitForTimeout(800);
        await page.screenshot({
          path: resolve(output, `${name}-tabs-selected.png`),
          clip: tabsClip,
        });

        // Real touch cancellation must not select the tab passed over.
        const from = await bounds(button("グループ"));
        const official = await bounds(button("公式"));
        const point = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        for (let i = 1; i <= 8; i++)
          await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: point.x + ((official.x - from.x) * i) / 8, y: point.y }],
          });
        await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        await page.waitForTimeout(800);
        assert.equal(await frame.evaluate(() => (window as any).liquidProbe.tab), "group");
        await click(page, button("公式"));
        await expect
          .poll(() => frame.evaluate(() => (window as any).liquidProbe.tab))
          .toBe("official");
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Space");
        await expect
          .poll(() => frame.evaluate(() => (window as any).liquidProbe.tab))
          .toBe("group");
        await page.emulateMedia({ reducedMotion: reduced ? "no-preference" : "reduce" });
        await expect
          .poll(() => frame.evaluate(() => (window as any).liquidProbe.reducedMotion))
          .toBe(!reduced);
        const groupAfterPreference = await bounds(button("グループ"));
        const allAfterPreference = await bounds(button("全体"));
        await page.mouse.move(
          groupAfterPreference.x + groupAfterPreference.width / 2,
          groupAfterPreference.y + groupAfterPreference.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          allAfterPreference.x + allAfterPreference.width / 2,
          allAfterPreference.y + allAfterPreference.height / 2,
          { steps: 16 },
        );
        await page.mouse.up();
        await expect.poll(() => frame.evaluate(() => (window as any).liquidProbe.tab)).toBe("all");
        assert.deepEqual(errors, []);
        results.push({
          appearance,
          reducedMotion: reduced,
          pressChange,
          springFrames,
          dragChange,
          returnChange,
          tabsChange,
          touchChange,
          evidence:
            "real canvas pixels: mouse press/drag/cancel, keyboard press+activation, tabs drag+snap+keyboard selection+live motion preference change, touch press+cancellation+activation after mouse hover",
          errors,
        });
        await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
        console.log(`${name}: PASS`);
      } catch (error) {
        await page.screenshot({ path: resolve(output, `${name}-failure.png`) });
        await writeFile(
          resolve(output, `${name}-failure.txt`),
          `${error}\n${errors.join("\n")}\n${await page.locator("body").ariaSnapshot()}`,
        );
        throw error;
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
