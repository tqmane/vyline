import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const deviceScaleFactor = process.env.VYLINE_PERF_DPR === "2" ? 2 : 1;
const output = resolve(import.meta.dir, "../test-results/kmp-performance");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
try {
  for (const mode of ["legacy", "apple", "fluent", "miuix"] as const) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor,
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((mode) => {
      if (window.top === window)
        localStorage.setItem(
          "vyline:design-system",
          JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
        );
      const probe = {
        start: 0,
        frames: [] as number[],
        longTasks: [] as number[],
        patches: [] as string[][],
      };
      (window as unknown as { uiProbe: typeof probe }).uiProbe = probe;
      let previous = 0;
      const tick = (time: number) => {
        if (probe.start && previous >= probe.start) probe.frames.push(time - previous);
        previous = time;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (probe.start && entry.startTime >= probe.start) probe.longTasks.push(entry.duration);
      }).observe({ type: "longtask" });
      window.addEventListener("message", (event) => {
        if (!probe.start || event.source !== parent) return;
        let value = event.data;
        if (typeof value === "string") {
          try {
            value = JSON.parse(value);
          } catch {
            return;
          }
        }
        if (value?.channel === "vyline-ui" && value.type === "patch")
          probe.patches.push(Object.keys(value));
      });
    }, mode);
    const started = Date.now();
    await page.goto(`${base}/pr-demo?stress=5000&images=1`, { waitUntil: "domcontentloaded" });
    const native = mode !== "legacy";
    if (native)
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
    else await expect(page.locator(".vy-chat-messages")).toBeVisible();
    const scope = native
      ? page.frames().find((frame) => frame.url().includes("/ui-compose/"))!
      : page.mainFrame();
    assert(scope);
    if (!native)
      await page.locator(".vy-chat-messages").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    await expect(scope.getByText(/スクロール確認 5000 \/ 5000/).first()).toBeAttached({
      timeout: 60_000,
    });
    const readyMs = Date.now() - started;
    await scope.evaluate(() => {
      const p = (window as unknown as { uiProbe: { start: number } }).uiProbe;
      p.start = performance.now();
    });
    await page.mouse.move(900, 450);
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, i < 16 ? -300 : 300);
      await page.waitForTimeout(80);
    }
    const editor = scope.getByRole("textbox", { name: "メッセージを入力", exact: true });
    const bounds = await editor.boundingBox();
    assert(bounds);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const inputStarted = Date.now();
    await page.keyboard.insertText("スクロール後の入力");
    await expect(
      page.locator('.vy-react-renderer textarea[aria-label="メッセージを入力"]'),
    ).toHaveValue("スクロール後の入力");
    const inputMs = Date.now() - inputStarted;
    const metrics = await scope.evaluate(() => {
      const p = (
        window as unknown as {
          uiProbe: { start: number; frames: number[]; longTasks: number[]; patches: string[][] };
        }
      ).uiProbe;
      p.start = 0;
      const sorted = [...p.frames].sort((a, b) => a - b);
      return {
        samples: sorted.length,
        rafMedianMs: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        rafP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        longTasks: p.longTasks,
        messagePatchesWhileTyping: p.patches.filter((keys) => keys.includes("messages")).length,
        semanticNodes: 0,
      };
    });
    metrics.semanticNodes = await scope.getByRole("button").count();
    assert.equal(errors.length, 0, errors.join("\n"));
    if (native) {
      assert.equal(
        metrics.messagePatchesWhileTyping,
        0,
        "Typing must not resend the message timeline",
      );
      assert(
        metrics.semanticNodes > 5 && metrics.semanticNodes < 350,
        "The 5000-message timeline must remain virtualized",
      );
    }
    let streaming: object | undefined;
    if (process.env.VYLINE_PERF_STREAM === "1") {
      await scope.evaluate(() => {
        const p = (
          window as unknown as {
            uiProbe: { start: number; frames: number[]; longTasks: number[]; patches: string[][] };
          }
        ).uiProbe;
        p.frames = [];
        p.longTasks = [];
        p.patches = [];
        p.start = performance.now();
      });
      await page.evaluate(async () => {
        // Import the exact Vite URL already used by this demo, including its HMR
        // timestamp. Importing a second URL would create a different store instance.
        const modulePath = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((name) => /\/src\/lib\/store(?:\.ts|\.js)?(?:\?|$)/.test(name));
        if (!modulePath) throw new Error("Streaming fixture requires the Vite demo");
        const { useStore } = await import(modulePath);
        if (!useStore.getState().demoMode || useStore.getState().accountId !== null)
          throw new Error("Streaming fixture requires the isolated demo");
        for (let i = 0; i < 24; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          useStore.setState((state: { messages: unknown[] }) => ({
            messages: [
              ...state.messages,
              {
                id: `incoming-perf-${i}`,
                chatId: "demo-chat-team",
                authorId: "demo-alice",
                kind: "text",
                text: `新着メッセージ ${i}`,
                createdAt: Date.now(),
                status: "sent",
                read: false,
                messageState: "normal",
              },
            ],
          }));
        }
      });
      streaming = await scope.evaluate(() => {
        const p = (
          window as unknown as {
            uiProbe: { start: number; frames: number[]; longTasks: number[]; patches: string[][] };
          }
        ).uiProbe;
        p.start = 0;
        const frames = p.frames.sort((a, b) => a - b);
        return {
          samples: frames.length,
          rafP95Ms: frames[Math.floor(frames.length * 0.95)],
          longTasks: p.longTasks,
          fullMessagePatches: p.patches.filter((keys) => keys.includes("messages")).length,
        };
      });
      // A fast benchmark that silently dropped incoming updates would be meaningless.
      if (native) {
        await page.mouse.move(900, 450);
        await page.mouse.wheel(0, 1_000_000);
      } else
        await page.locator(".vy-chat-messages").evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
      await expect(scope.getByText("新着メッセージ 23", { exact: true }).first()).toBeAttached({
        timeout: 10_000,
      });
    }
    const result = {
      mode,
      deviceScaleFactor,
      count: 5000,
      images: true,
      readyMs,
      inputMs,
      ...metrics,
      streaming,
      errors,
    };
    console.log(JSON.stringify(result));
    results.push(result);
    await page.screenshot({ path: resolve(output, `${mode}-5000.png`) });
    await page.close();
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
