import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-media-interactions");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

async function point(page: Page, locator: Locator, gesture: "click" | "tap" | "hold" | "context" = "click") {
  await expect(locator).toBeAttached();
  let previous = "";
  await expect.poll(async () => {
    const next = JSON.stringify(await locator.boundingBox());
    const stable = next !== "null" && next === previous;
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

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const errors: string[] = [];
    const requests: string[] = [];
    let stage = "load";
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.url().includes("/demo/chat-photo.svg")) requests.push(request.url()); });
    try {
      await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "light" }, version: 0 })), mode);
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const menu = native.getByRole("button", { name: "詳細・その他の操作", exact: true });
      stage = "photo tap and full-resolution viewer";
      await fixture(page, "image");
      const photo = native.getByLabel("検証用画像.svg", { exact: true });
      await point(page, photo, "tap");
      await expect(native.getByRole("button", { name: "閉じる", exact: true })).toBeAttached();
      await expect.poll(() => requests.some(url => new URL(url).searchParams.get("preview") === "0")).toBe(true);
      await page.screenshot({ path: resolve(output, `${mode}-photo-viewer.png`) });
      await page.keyboard.press("Escape");
      await expect(native.getByRole("button", { name: "閉じる", exact: true })).toHaveCount(0);
      stage = "photo hold and hosted download";
      await point(page, photo, "hold");
      await expect(menu).toBeAttached();
      await point(page, menu);
      const detail = page.getByRole("dialog", { name: "メッセージの詳細", exact: true });
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "メッセージの操作", exact: true }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: "画像をダウンロード", exact: true }).click();
      assert((await download).suggestedFilename().endsWith(".jpg"));
      await page.keyboard.press("Escape");
      await expect(detail).toHaveCount(0);

      await fixture(page, "sticker", true);
      stage = "animated sticker Enter and Escape";
      const sticker = native.locator('button[aria-label="検証用アニメーション"]');
      await expect(sticker).toBeVisible();
      await sticker.focus();
      await page.keyboard.press("Enter");
      await expect(native.locator('img[alt="検証用アニメーション"]')).toBeVisible();
      await expect(native.getByRole("button", { name: "閉じる", exact: true })).toBeAttached();
      await expect.poll(() => native.locator("canvas").evaluate(canvas => (canvas.getRootNode() as ShadowRoot).activeElement === canvas)).toBe(true);
      stage = "animated viewer Tab activation";
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Enter");
      await expect(native.locator('img[alt="検証用アニメーション"]')).toHaveCount(0);
      await expect(sticker).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(native.locator('img[alt="検証用アニメーション"]')).toBeVisible();
      await expect(native.getByRole("button", { name: "閉じる", exact: true })).toBeAttached();
      stage = "animated viewer Escape and focus return";
      await expect.poll(() => native.locator("canvas").evaluate(canvas => (canvas.getRootNode() as ShadowRoot).activeElement === canvas)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(native.locator('img[alt="検証用アニメーション"]')).toHaveCount(0);
      await expect(native.getByRole("button", { name: "閉じる", exact: true })).toHaveCount(0);
      await expect(sticker).toBeFocused();
      stage = "animated sticker keyboard context menu";
      await sticker.focus();
      await page.keyboard.press("Shift+F10");
      await expect(menu).toBeAttached();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);

      for (const kind of ["audio", "video"] as const) {
        stage = `${kind} playback and context menus`;
        await fixture(page, kind);
        const media = native.locator(kind);
        await expect(media).toBeVisible();
        await expect.poll(() => media.evaluate(element => (element as HTMLMediaElement).readyState)).toBeGreaterThanOrEqual(1);
        const box = await media.boundingBox(); assert(box);
        await page.mouse.click(box.x + 25, box.y + (kind === "audio" ? box.height / 2 : box.height - 48));
        await expect.poll(() => media.evaluate(element => !(element as HTMLMediaElement).paused)).toBe(true);
        await page.mouse.click(box.x + 25, box.y + (kind === "audio" ? box.height / 2 : box.height - 48));
        await expect.poll(() => media.evaluate(element => (element as HTMLMediaElement).paused)).toBe(true);
        await media.focus();
        await page.keyboard.press("Shift+F10");
        await expect(menu).toBeAttached();
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await point(page, media, "context");
        await expect(menu).toBeAttached();
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
      }

      const tools = native.getByRole("button", { name: "添付とその他の操作", exact: true });
      stage = "file chooser, remove, clear, drop and paste";
      if (mode === "apple") await point(page, tools);
      const files = page.waitForEvent("filechooser");
      await point(page, native.getByRole("button", { name: "添付ファイルを選択", exact: true }));
      await (await files).setFiles([{ name: "first.png", mimeType: "image/png", buffer: png }, { name: "second.png", mimeType: "image/png", buffer: png }]);
      await expect(native.getByRole("button", { name: "first.pngを削除", exact: true })).toBeAttached();
      await page.screenshot({ path: resolve(output, `${mode}-pending-attachments.png`) });
      await point(page, native.getByRole("button", { name: "first.pngを削除", exact: true }), "tap");
      await expect(native.getByRole("button", { name: "first.pngを削除", exact: true })).toHaveCount(0);
      await point(page, native.getByRole("button", { name: "添付をすべてクリア", exact: true }));
      await expect(native.getByRole("button", { name: "second.pngを削除", exact: true })).toHaveCount(0);
      const frame = page.frames().find(frame => frame.url().includes("/dist/ui-compose/index.html")); assert(frame);
      for (const type of ["drop", "paste"] as const) {
        await frame.evaluate(({ type, bytes }) => {
          const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], `${type}.png`, { type: "image/png" }));
          const event = type === "paste" ? new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })
            : new DragEvent("drop", { dataTransfer: transfer, clientX: 190, clientY: 350, bubbles: true, cancelable: true });
          window.dispatchEvent(event);
        }, { type, bytes: [...png] });
        await expect(native.getByRole("button", { name: `${type}.pngを削除`, exact: true })).toBeAttached();
        await point(page, native.getByRole("button", { name: "添付をすべてクリア", exact: true }));
      }
      assert.deepEqual(errors, []);
      results.push({ mode, viewport: "390x844 DPR2", photoTapFullResolution: true, photoLongPressDownload: true,
        animatedStickerKeyboardAndContext: true, audioVideoPlaybackAndContext: true, fileChooserRemoveClear: true, syntheticDropPaste: true, errors });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error({ mode, stage, errors, native: await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot() }); throw error;
    } finally { await page.close(); }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(results);
} finally { await browser.close(); }
