import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/call-layout");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
const scenarios = [
  "voice",
  "video",
  "group",
  "failed",
  "starting",
  "acquiring",
  "connecting",
  "ringing",
  "ending",
  "ended",
  "recording-error",
  "recording-starting",
  "recording-saving",
];
const labels: Record<string, string> = {
  starting: "発信準備中…",
  acquiring: "ルート取得中…",
  connecting: "接続中…",
  ringing: "呼び出し中…（相手の応答を待っています）",
  ending: "終了中…",
  ended: "通話終了",
  failed: "接続を確認してから、もう一度お試しください。",
};
try {
  for (const mode of ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({
      viewport: { width: 375, height: 667 },
      deviceScaleFactor: 2,
    });
    const errors: string[] = [];
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (
        url.pathname.startsWith("/api/") ||
        (["http:", "https:"].includes(url.protocol) && url.origin !== new URL(base).origin)
      )
        return route.abort();
      return route.continue();
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (mode) =>
        localStorage.setItem(
          "vyline:design-system",
          JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
        ),
      mode,
    );
    await page.goto(`${base}/pr-demo`);
    await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
    const mount = async (scenario: string, dark: boolean) =>
      page.evaluate(
        async ({ scenario, dark }) => {
          const path = performance
            .getEntriesByType("resource")
            .find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")!.name;
          const { useStore } = await import(path);
          if (!useStore.getState().demoMode || useStore.getState().accountId !== null)
            throw new Error("Account-free demo required");
          const { useDesignSystemStore } = await import("/src/ui/design-system-store.ts");
          useDesignSystemStore.getState().setAppearance(dark ? "dark" : "light");
          const reactModule = await import("/node_modules/.vite/deps/react.js");
          const React = reactModule.default ?? reactModule;
          const client = await import("/node_modules/.vite/deps/react-dom_client.js");
          const createRoot = client.createRoot ?? client.default.createRoot;
          const { CallLayoutFixture } = await import("/scripts/call-layout-fixture.tsx");
          const target = window as any;
          if (!target.callFixtureRoot) {
            const node = document.createElement("div");
            document.body.appendChild(node);
            target.callFixtureRoot = createRoot(node);
          }
          target.callFixtureRoot.render(
            React.createElement(CallLayoutFixture, { scenario, key: `${scenario}-${dark}` }),
          );
        },
        { scenario, dark },
      );
    try {
      for (const [width, height] of [
        [375, 667],
        [667, 375],
        [1440, 900],
      ]) {
        await page.setViewportSize({ width, height });
        for (const scenario of scenarios) {
          await mount(scenario, scenario === "video" || scenario === "failed");
          const panel = page.locator("[data-call-fixture] [data-call-panel]");
          const outputState = page.locator("[data-call-fixture] output");
          const panelMode = width >= 640 && height >= 480 ? "docked" : "expanded";
          await expect(panel).toBeVisible();
          await expect.poll(() => panel.getAttribute("data-call-panel")).toBe(panelMode);
          if (labels[scenario])
            await expect(panel.getByText(labels[scenario], { exact: true })).toBeVisible();
          await page.waitForTimeout(150);
          const dimensions = await panel.evaluate((panel) => {
            const rect = panel.getBoundingClientRect();
            return {
              width: rect.width,
              height: rect.height,
              overflow: panel.scrollWidth > panel.clientWidth,
              buttons: Array.from(panel.querySelectorAll("button"))
                .filter((button) => button.getClientRects().length)
                .map((button) => {
                  const box = button.getBoundingClientRect();
                  return {
                    label: button.getAttribute("aria-label") || button.textContent?.trim(),
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                  };
                }),
            };
          });
          assert(!dimensions.overflow, `${mode}/${scenario}/${width}: horizontal overflow`);
          const verifyControls = async () => {
            for (const button of await panel.locator(".vy-call-controls button").all()) {
              assert(
                await button.evaluate((button) => {
                  const r = button.getBoundingClientRect();
                  return (
                    r.width >= 44 &&
                    r.height >= 44 &&
                    r.left >= 0 &&
                    r.right <= innerWidth &&
                    r.bottom <= innerHeight &&
                    r.top >= 0 &&
                    button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 28))
                  );
                }),
                `${mode}/${scenario}/${width}: call control is too small, covered or outside viewport`,
              );
            }
          };
          await verifyControls();
          await page.screenshot({ path: resolve(output, `${mode}-${scenario}-${width}.png`) });
          if (scenario === "voice") {
            await panel.getByRole("button", { name: "ミュート", exact: true }).click();
            await expect(outputState).toContainText('"muted":true');
            await panel.getByRole("button", { name: "ミュート解除", exact: true }).click();
            await expect(outputState).toContainText('"muted":false');
            await panel.locator(".vy-call-recording summary").click();
            await panel.getByRole("button", { name: "自動", exact: true }).click();
            await expect(outputState).toContainText('"automatic":true');
            await panel.getByRole("button", { name: "手動", exact: true }).click();
            await expect(outputState).toContainText('"automatic":false');
            await panel.getByRole("button", { name: "録画", exact: true }).click();
            await expect(outputState).toContainText('"kind":"video"');
            await panel.getByRole("button", { name: "録音", exact: true }).click();
            await expect(outputState).toContainText('"kind":"audio"');
            await panel.getByRole("button", { name: "録音を開始", exact: true }).click();
            await expect(
              panel.getByRole("button", { name: "記録を停止", exact: true }),
            ).toBeVisible();
            await expect(outputState).toContainText('"recordingState":"recording"');
            await expect(panel.getByRole("button", { name: "録画", exact: true })).toBeDisabled();
            await verifyControls();
            await panel.getByRole("button", { name: "記録を停止", exact: true }).click();
            await expect(outputState).toContainText('"recordingState":"saved"');
            await panel
              .getByRole("button", { name: "通話を小さくしてトークを見る", exact: true })
              .click();
            await expect(panel).toHaveAttribute("data-call-panel", "minimized");
            await panel.getByRole("button", { name: "通話へ戻る", exact: true }).click();
            await expect(panel).toHaveAttribute("data-call-panel", panelMode);
            if (panelMode === "docked") {
              const divider = panel.getByRole("separator", {
                name: "通話ペインの幅を調整",
                exact: true,
              });
              const before = Number(await divider.getAttribute("aria-valuenow"));
              await divider.click();
              await page.keyboard.press("ArrowLeft");
              await expect(divider).toHaveAttribute("aria-valuenow", String(before + 24));
              await page.keyboard.press("ArrowRight");
              await expect(divider).toHaveAttribute("aria-valuenow", String(before));
            }
          }
          if (scenario === "video") {
            await panel
              .getByRole("button", { name: "前後のカメラを切り替え", exact: true })
              .click();
            await expect(outputState).toContainText('"switches":1');
            await panel.getByRole("button", { name: "分割", exact: true }).click();
            await expect(panel.locator("[data-call-stage]")).toHaveAttribute(
              "data-call-stage",
              "split",
            );
            const divider = panel.getByRole("separator", {
              name: "映像の分割位置を調整",
              exact: true,
            });
            const before = Number(await divider.getAttribute("aria-valuenow"));
            const vertical = (await divider.getAttribute("aria-orientation")) === "vertical";
            await divider.click();
            await page.keyboard.press(vertical ? "ArrowRight" : "ArrowDown");
            await expect(divider).toHaveAttribute("aria-valuenow", String(before + 5));
            await panel.getByRole("button", { name: "カメラを停止", exact: true }).click();
            await expect(outputState).toContainText('"camera":false');
            await panel
              .getByRole("button", { name: "カメラを開始してビデオ通話に切り替え", exact: true })
              .click();
            await expect(outputState).toContainText('"camera":true');
          }
          if (scenario === "recording-error") {
            await panel.locator(".vy-call-recording summary").click();
            await panel.getByRole("button", { name: "録音を開始", exact: true }).click();
            await expect(outputState).toContainText('"recordingState":"error"');
            await expect(panel.locator(".vy-call-recording")).toHaveJSProperty("open", true);
            await expect(panel.locator(".vy-call-recording summary")).toContainText(
              "記録エラー：録音デバイスを開けませんでした",
            );
            await expect(panel.getByRole("status")).toHaveText("録音デバイスを開けませんでした");
            await verifyControls();
            await page.screenshot({
              path: resolve(output, `${mode}-recording-error-${width}.png`),
            });
          }
          if (scenario === "recording-starting" || scenario === "recording-saving") {
            await expect(panel.locator(".vy-call-recording summary")).toContainText(
              scenario === "recording-starting" ? "記録を準備中…" : "記録を保存中…",
            );
            await expect(panel.getByRole("button", { name: "手動", exact: true })).toBeDisabled();
            if (scenario === "recording-saving")
              await expect(
                panel.getByRole("button", { name: "保存中…", exact: true }),
              ).toBeDisabled();
          }
          await panel
            .getByRole("button", {
              name:
                scenario === "failed" || scenario === "ended" ? "通話画面を閉じる" : "通話を終了",
              exact: true,
            })
            .click();
          await expect(outputState).toContainText('"closed":true');
          await expect(panel).toHaveCount(0);
          results.push({ mode, scenario, width, height, dimensions });
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(`${results.length} call layouts passed`);
} finally {
  await browser.close();
}
