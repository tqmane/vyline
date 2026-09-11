import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";
const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5186";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = resolve(import.meta.dir, "../test-results/ui-parity");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const results: object[] = [];
async function point(page: Page, locator: Locator, gesture: "click" | "tap" | "hold" | "context" = "click") {
  await expect(locator).toBeAttached();
  let previous = "";
  let stableCount = 0;
  await expect.poll(async () => {
    const next = JSON.stringify(await locator.boundingBox());
    stableCount = next !== "null" && next === previous ? stableCount + 1 : 0;
    const stable = stableCount >= 3;
    previous = next;
    return stable;
  }, { intervals: [100] }).toBe(true);
  const box = await locator.boundingBox();
  assert(box && box.width > 0 && box.height > 0);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (gesture === "tap") await page.touchscreen.tap(x, y);
  else if (gesture === "hold") {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
  } else await page.mouse.click(x, y, { button: gesture === "context" ? "right" : "left" });
}

// Explicitly account-free synthetic media enters the same store -> projector ->
// Compose path as received messages. No LINE send or network mutation is used.
async function fixture(page: Page, kind: "image" | "sticker" | "audio" | "video", animated = false) {
  await page.evaluate(async ({ kind, animated }) => {
    const path = performance.getEntriesByType("resource").map(entry => entry.name)
      .find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
    if (!path) throw new Error("Loaded store module not found");
    const { useStore } = await import(path);
    const state = useStore.getState();
    if (!state.demoMode || state.accountId !== null) throw new Error("Demo-only fixture");
    let url = kind === "sticker" ? "/demo/sticker-heart.svg" : "/demo/chat-photo.svg?preview=1";
    if (kind === "audio") {
      const bytes = new ArrayBuffer(44 + 16000 * 2 * 2);
      const view = new DataView(bytes);
      const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVEfmt ");
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      text(36, "data"); view.setUint32(40, bytes.byteLength - 44, true);
      url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    } else if (kind === "video") {
      const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext("2d")!; context.fillStyle = "#007aff"; context.fillRect(0, 0, 160, 90);
      const stream = canvas.captureStream(12);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      context.fillStyle = "#34c759"; context.fillRect(0, 0, 160, 90);
      await new Promise(resolve => setTimeout(resolve, 800));
      recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
      url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
    }
    useStore.setState({ messages: [{ id: `demo-media-${kind}-${animated}`, chatId: state.activeChatId, authorId: "me",
      kind, text: kind === "sticker" ? "検証用アニメーション" : undefined,
      imageSrc: kind === "image" || kind === "video" ? url : undefined, audioSrc: kind === "audio" ? url : undefined,
      sticker: kind === "sticker" ? url : undefined, stickerAnimated: animated,
      file: { name: kind === "video" ? "検証用動画.webm" : "検証用画像.svg" },
      createdAt: Date.now(), status: "sent", read: false, messageState: "normal" }] });
  }, { kind, animated });
}

async function recordedAudioFixture(page: Page) {
  await page.evaluate(async () => {
    const path = performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
    if (!path) throw new Error("Store not loaded");
    const { useStore } = await import(path);
    const state = useStore.getState();
    if (!state.demoMode || state.accountId !== null) throw new Error("Demo only");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start(100);
    await new Promise(resolve => setTimeout(resolve, 1250));
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    useStore.setState({ messages: [{ id: "legacy-webm", chatId: state.activeChatId, authorId: "me", kind: "audio", audioSrc: URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })), createdAt: Date.now(), status: "sent", read: false, messageState: "normal" }] });
  });
}

async function pinch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const touches = (distance: number) => [{ x: 195 - distance, y: 430, id: 1 }, { x: 195 + distance, y: 430, id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches(30) });
  for (let distance = 40; distance <= 90; distance += 10) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touches(distance) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["legacy", "apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await page.emulateMedia({ reducedMotion: process.env.VYLINE_TEST_ANIMATIONS === "1" ? "no-preference" : "reduce" });
    const errors: string[] = [];
    let stage = "load";
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });
    try {
      await page.addInitScript(() => { if (window !== parent && location.pathname === "/dist/ui-compose/index.html") { const url = new URL(location.href); url.searchParams.set("selftest", "1"); history.replaceState(history.state, "", url); } });
      await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 })), mode);
      await page.goto(`${base}/pr-demo`);
      if (mode === "legacy") {
        stage = "classic audio and image gestures";
        await expect(page.locator("textarea").first()).toBeVisible();
        await fixture(page, "audio");
        await expect(page.getByText("0:00 / 0:02", { exact: true })).toBeVisible();
        await recordedAudioFixture(page);
        await expect(page.getByText("0:00 / 0:01", { exact: true })).toBeVisible();
        await fixture(page, "image");
        await page.locator('img[src*="/demo/chat-photo.svg"]').click();
        const photo = page.locator("dialog img");
        await expect(photo).toBeVisible();
        await photo.locator("..").click();
        await expect(photo).toHaveAttribute("data-zoom", "2");
        await photo.locator("..").click();
        await expect(photo).toHaveAttribute("data-zoom", "1");
        await pinch(page);
        await expect.poll(async () => Number(await photo.getAttribute("data-zoom"))).toBeGreaterThan(1.5);
        await page.screenshot({ path: resolve(output, "classic-image-pinch.png") });
        await page.getByRole("button", { name: "閉じる", exact: true }).click();
        assert.deepEqual(errors, []);
        results.push({ mode, audio: true, clickZoom: true, pinch: true });
        continue;
      }
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 90_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      stage = "native audio duration and playback";
      await fixture(page, "audio");
      await expect.poll(() => native.locator("body").ariaSnapshot()).toContain("0:00 / 0:02");
      await point(page, native.getByRole("button", { name: "再生", exact: true }));
      await expect(native.getByRole("button", { name: "一時停止", exact: true })).toBeAttached();
      await point(page, native.getByRole("button", { name: "一時停止", exact: true }));
      await page.screenshot({ path: resolve(output, `${mode}-audio.png`) });
      await recordedAudioFixture(page);
      await expect.poll(() => native.locator("body").ariaSnapshot()).toContain("0:00 / 0:01");
      stage = "middle-button autoscroll";
      await page.evaluate(async () => {
        const path = performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
        const { useStore } = await import(path!);
        const state = useStore.getState();
        if (!state.demoMode || state.accountId !== null) throw new Error("Demo only");
        useStore.setState({ messages: Array.from({ length: 150 }, (_, index) => ({ id: `autoscroll-${index}`, chatId: state.activeChatId, authorId: "me", kind: "text", text: `自動スクロール ${index}`, createdAt: Date.now() + index, status: "sent", read: false, messageState: "normal" })) });
      });
      const history = native.getByRole("list", { name: "メッセージ履歴", exact: true });
      await expect.poll(() => history.ariaSnapshot()).toContain("自動スクロール 149");
      const beforeScroll = await history.ariaSnapshot();
      await page.mouse.click(195, 430, { button: "middle" });
      const marker = native.getByRole("img", { name: "自動スクロール", exact: true });
      await expect(marker).toBeVisible();
      await page.mouse.move(195, 270);
      await expect.poll(() => history.ariaSnapshot()).not.toBe(beforeScroll);
      await page.screenshot({ path: resolve(output, `${mode}-autoscroll.png`) });
      await page.keyboard.press("Escape");
      await expect(marker).toHaveCount(0);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const frame = page.frames().find(frame => frame.url().includes("/dist/ui-compose/index.html"))!;
      const position = () => frame.evaluate(() => Object.values((window as unknown as { __vylineTimelines?: Record<string, { lastIndex: number; lastOffset: number; generation: number; ownership: string }> }).__vylineTimelines ?? {}).map(value => ({ lastIndex: value.lastIndex, lastOffset: value.lastOffset, generation: value.generation, ownership: value.ownership })));
      const stoppedScroll = await position();
      await page.waitForTimeout(200);
      assert.deepEqual(await position(), stoppedScroll, "Escape stops autoscroll");
      stage = "image click zoom";
      await fixture(page, "image");
      await point(page, native.getByLabel("検証用画像.svg", { exact: true }));
      await expect(native.getByRole("button", { name: "閉じる", exact: true })).toBeAttached();
      const image = native.getByLabel("検証用画像.svg", { exact: true }).last();
      await point(page, image);
      await expect(image).toHaveAttribute("aria-description", "200%");
      await page.screenshot({ path: resolve(output, `${mode}-image-zoom.png`) });
      await point(page, image);
      await expect(image).toHaveAttribute("aria-description", "100%");
      stage = "image pinch";
      await pinch(page);
      await expect.poll(async () => Number((await image.getAttribute("aria-description"))?.replace("%", ""))).toBeGreaterThan(150);
      await page.screenshot({ path: resolve(output, `${mode}-image-pinch.png`) });
      await point(page, native.getByRole("button", { name: "閉じる", exact: true }));
      await expect(native.getByRole("button", { name: "閉じる", exact: true })).toHaveCount(0);
      stage = "recording meter";
      await point(page, native.getByRole("button", { name: "音声メッセージを録音", exact: true }));
      await expect.poll(() => native.locator("body").ariaSnapshot()).toContain("0:01");
      await page.screenshot({ path: resolve(output, `${mode}-recording.png`) });
      await point(page, native.getByRole("button", { name: "録音をキャンセル", exact: true }));
      await expect(native.getByRole("button", { name: "録音をキャンセル", exact: true })).toHaveCount(0);
      stage = "separate file and media choosers";
      const tools = native.getByRole("button", { name: "添付とその他の操作", exact: true });
      for (const label of ["ファイル", "写真・動画"]) {
        await point(page, tools);
        const picked = page.waitForEvent("filechooser");
        await point(page, native.getByRole("button", { name: label, exact: true }));
        const chooser = await picked;
        assert.equal(await chooser.element().getAttribute("accept"), label === "ファイル" ? "" : "image/*,video/*");
        await chooser.setFiles(label === "ファイル" ? [{ name: "document.txt", mimeType: "text/plain", buffer: Buffer.from("test") }] : []);
        if (label === "ファイル") {
          await expect(native.getByRole("button", { name: "document.txtを削除", exact: true })).toBeAttached();
          await point(page, native.getByRole("button", { name: "添付をすべてクリア", exact: true }));
        }
      }
      await page.reload();
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 90_000 });
      stage = "conversation sheets";
      for (const label of ["スタンプと絵文字", "ノート・アルバム・イベント"]) {
        stage = `open ${label}`;
        await point(page, tools);
        await point(page, native.getByRole("button", { name: label, exact: true }));
        await expect(native.getByRole("heading", { name: label === "スタンプと絵文字" ? "スタンプ・絵文字" : label, exact: true })).toBeAttached();
        await expect(native.getByRole("button", { name: "写真・動画", exact: true })).toHaveCount(0);
        const close = native.getByRole("button", { name: "閉じる", exact: true });
        await expect(close).toBeAttached();
        const rect = await close.boundingBox(); assert(rect && rect.y > 250, "Sheet must preserve the conversation above it");
        stage = `close ${label}`;
        await page.screenshot({ path: resolve(output, `${mode}-${label === "スタンプと絵文字" ? "stickers" : "tools"}.png`) });
        await point(page, close);
        await expect(close).toHaveCount(0);
      }
      stage = "settings split sidebar";
      if (mode === "apple") await point(page, tools);
      await point(page, native.getByRole("button", { name: "設定", exact: true }).last());
      await page.setViewportSize({ width: 1280, height: 900 });
      const category = native.getByRole("tab", { name: "外観・UI", exact: true });
      await expect(category).toBeAttached();
      await point(page, category);
      await expect(category).toHaveAttribute("aria-selected", "true");
      await page.screenshot({ path: resolve(output, `${mode}-settings.png`) });
      await point(page, native.getByRole("button", { name: "閉じる", exact: true }));
      await expect(native.getByRole("button", { name: "閉じる", exact: true })).toHaveCount(0);
      stage = "split drop preview";
      const row = native.getByRole("button", { name: /機能ギャラリー.*すべて撮影用/ }).first();
      await expect(row).toBeAttached();
      const bounds = await row.boundingBox(); assert(bounds);
      await page.mouse.move(bounds.x + 60, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(1120, 320, { steps: 15 });
      const preview = native.getByLabel("分割の配置プレビュー", { exact: true });
      await expect(preview).toBeAttached();
      const region = await preview.boundingBox(); assert(region && region.x > 700 && region.width > 250);
      await page.screenshot({ path: resolve(output, `${mode}-split-preview.png`) });
      await page.mouse.up();
      await expect(native.getByRole("textbox", { name: "メッセージを入力", exact: true })).toHaveCount(2);
      assert.deepEqual(errors, []);
      results.push({ mode, audio: true, zoom: true, filePicker: true, sheets: true, settings: true, pinch: true, recording: true, splitPreview: true, middleAutoScroll: true });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error({ mode, stage, errors, aria: mode === "legacy" ? await page.locator("body").ariaSnapshot() : await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot() });
      throw error;
    } finally { await page.close(); }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(results);
} finally { await browser.close(); }
