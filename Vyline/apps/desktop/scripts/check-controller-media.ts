import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5186";
const output = `test-results/controller-media/${Date.now()}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { ok: true, chats: [], members: [], results: [] } });
    return route.continue();
  });
  await page.addInitScript(() => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode: "apple", appearance: "dark" }, version: 0 })));
  await page.goto(`${base}/pr-demo`);
  await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const React = (await load("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { NativeControllerSurface } = await load("/src/ui/native-controller-surface.tsx");
    const { CallVideoStage } = await load("/src/components/call-video-stage.tsx");
    const { useDesignSystemStore } = await load("/src/ui/design-system-store.ts");
    const source = document.createElement("canvas"); source.width = 320; source.height = 180;
    const context = source.getContext("2d")!; context.fillStyle = "#167cd3"; context.fillRect(0, 0, 320, 180);
    const stream = source.captureStream(10);
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const probe = (window as any).__mediaProbe = { original: null, attaches: 0, detaches: 0, stream, native: true };
    const video = React.createElement("video", { autoPlay: true, muted: true, playsInline: true, "data-probe-video": "true", style: { width: "100%", height: "100%" }, ref: (element: HTMLVideoElement | null) => {
      if (element) { probe.attaches++; probe.original ??= element; element.srcObject = stream; } else probe.detaches++;
    } });
    const render = () => root.render(React.createElement(NativeControllerSurface, { native: probe.native, title: "映像の保持検証", onClose: () => {} },
      React.createElement(CallVideoStage, { tiles: [{ id: "one", name: "カメラ", visible: true, content: video }, { id: "two", name: "画面共有", visible: true, content: React.createElement("div", { style: { background: "#a82660", height: "100%" } }, "画面共有") }] })));
    probe.render = (native: boolean) => { probe.native = native; host.style.cssText = native ? "" : "position:fixed;inset:0;z-index:200;background:black;display:flex"; render(); };
    probe.theme = (mode: string) => useDesignSystemStore.getState().setMode(mode);
    probe.dispose = () => { root.unmount(); stream.getTracks().forEach((track) => track.stop()); host.remove(); };
    render();
  });
  const frame = page.frames().find((frame) => frame.url().includes("ui-compose"))!;
  const video = frame.locator("video[data-probe-video]");
  await expect(video).toBeVisible({ timeout: 30000 });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
  await frame.getByRole("button", { name: "分割", exact: true }).click();
  await expect(frame.locator('[data-call-stage="split"]')).toBeVisible();
  for (const mode of ["fluent", "miuix", "apple"]) {
    await page.evaluate((mode) => (window as any).__mediaProbe.theme(mode), mode);
    await expect(video).toBeVisible();
    await expect.poll(() => page.evaluate(() => { const p = (window as any).__mediaProbe; return p.original.isConnected && p.original.srcObject === p.stream && p.attaches === 1 && p.detaches === 0; })).toBe(true);
  }
  await page.screenshot({ path: `${output}/native-split.png` });
  await page.evaluate(() => (window as any).__mediaProbe.render(false));
  await expect(page.locator("video[data-probe-video]")).toBeVisible();
  await expect(frame.getByText("映像の保持検証", { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__mediaProbe.render(true));
  await expect(video).toBeVisible();
  const result = await page.evaluate(() => { const p = (window as any).__mediaProbe; return { attaches: p.attaches, detaches: p.detaches, retainedStream: p.original.srcObject === p.stream, visible: p.original.isConnected }; });
  assert.deepEqual(result, { attaches: 1, detaches: 0, retainedStream: true, visible: true });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(`Controller media PASS: native layout controls, three themes, native/legacy reparenting retain the same video and stream. ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  await writeFile(`${output}/errors.json`, JSON.stringify(errors));
  throw error;
} finally {
  await page.evaluate(() => (window as any).__mediaProbe?.dispose()).catch(() => {});
  await browser.close();
}
