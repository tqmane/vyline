import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

// Real touch/key events on the real /pr-demo renderer. No LINE account or send.
const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-message-interactions");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
const failures: { mode: string; error: string }[] = [];

async function center(locator: Locator) {
  await expect(locator).toBeAttached();
  let previous = "";
  let stableSamples = 0;
  await expect.poll(async () => {
    const current = JSON.stringify(await locator.boundingBox());
    const stable = current !== "null" && current === previous;
    previous = current;
    stableSamples = stable ? stableSamples + 1 : 0;
    return stableSamples >= 3;
  }, { intervals: [100] }).toBe(true);
  const box = await locator.boundingBox();
  assert(box && box.width > 0 && box.height > 0, "Native target has visible canvas bounds");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function tap(page: Page, locator: Locator) {
  const point = await center(locator);
  await page.touchscreen.tap(point.x, point.y);
}
async function touch(page: Page, locator: Locator, dx: number, dy: number, hold = 0) {
  const point = await center(locator);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  if (hold) await page.waitForTimeout(hold);
  for (let step = 1; step <= 8 && (dx || dy); step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: point.x + dx * step / 8, y: point.y + dy * step / 8 }],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  // A released gesture posts through the iframe bridge before its store echo.
  await page.waitForTimeout(200);
}

async function patchMessage(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(async (patch) => {
    const path = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")?.name;
    if (!path) throw new Error("Loaded store module missing");
    const { useStore } = await import(path);
    const state = useStore.getState();
    if (!state.demoMode || state.accountId !== null) throw new Error("Account-free demo required");
    useStore.setState({ messages: state.messages.map((message: any) => message.id === "demo-message-4" ? { ...message, ...patch } : message) });
  }, patch);
}

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((mode) => localStorage.setItem("vyline:design-system",
      JSON.stringify({ state: { mode, appearance: "light" }, version: 0 })), mode);
    await page.addInitScript(() => {
      (window as any).kmpMessageActions = [];
      (window as any).kmpSwipeVibrations = [];
      Object.defineProperty(navigator, "vibrate", { configurable: true, value: (duration: number | number[]) => {
        (window as any).kmpSwipeVibrations.push(duration);
        return true;
      } });
      window.addEventListener("message", (event) => {
        if (event.origin === location.origin && event.data?.channel === "vyline-ui" && event.data?.type === "action")
          (window as any).kmpMessageActions.push(event.data);
      });
    });
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const vibrations = () => page.locator('iframe[title="Vyline Compose UI"]').evaluate((iframe: HTMLIFrameElement) =>
        (iframe.contentWindow as any).kmpSwipeVibrations as (number | number[])[]);
      const bubble = native.getByRole("button", { name: "個人情報を含まない安全なPRデモです。", exact: true });
      const reply = native.getByRole("button", { name: "返信", exact: true });
      const cancelReply = native.getByRole("button", { name: "返信をキャンセル", exact: true });
      const initialReader = native.getByRole("button", { name: "既読者一覧 2人", exact: true }).last();
      await expect(native.getByRole("button", { name: "最新のメッセージへ", exact: true })).toHaveCount(0);
      const lastReaderAboveComposer = async () => {
        const reader = await native.getByRole("button", { name: "既読者一覧 2人", exact: true }).last().boundingBox();
        const field = await native.getByRole("textbox", { name: "メッセージを入力", exact: true }).boundingBox();
        return !!reader && !!field && reader.y + reader.height < field.y;
      };
      await expect.poll(lastReaderAboveComposer).toBe(true);
      await tap(page, initialReader);
      await expect(native.getByRole("button", { name: "既読一覧を閉じる", exact: true })).toBeAttached();
      await page.keyboard.press("Escape");
      await expect(native.getByRole("button", { name: "既読一覧を閉じる", exact: true })).toHaveCount(0);
      await tap(page, bubble);
      await expect(reply).toHaveCount(0);
      await page.waitForTimeout(500);
      await touch(page, bubble, 0, 0, 900);
      await expect(reply).toBeAttached();
      console.log(mode, "long press opened");
      await page.keyboard.press("Escape");
      await expect(reply).toHaveCount(0);
      console.log(mode, "long press Escape passed");
      await touch(page, bubble, -80, 0, 900);
      await expect(reply).toBeAttached();
      await expect(cancelReply).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(reply).toHaveCount(0);

      const doublePoint = await center(bubble);
      await page.touchscreen.tap(doublePoint.x, doublePoint.y);
      await page.waitForTimeout(80);
      await page.touchscreen.tap(doublePoint.x, doublePoint.y);
      await expect(reply).toBeAttached();
      const frameBounds = await page.locator('iframe[title="Vyline Compose UI"]').boundingBox();
      assert(frameBounds);
      await page.touchscreen.tap(frameBounds.x + 5, frameBounds.y + 5);
      await expect(reply).toHaveCount(0);
      console.log(mode, "double tap outside passed");
      const longPressVibrations = await vibrations();
      // Compose itself requests a [0, 30] long-press vibration. Start a separate
      // interval so invalid swipes must emit no vibration of any duration.
      await page.locator('iframe[title="Vyline Compose UI"]').evaluate((iframe: HTMLIFrameElement) => {
        (iframe.contentWindow as any).kmpSwipeVibrations = [];
      });
      await touch(page, bubble, 65, 0);
      await expect(cancelReply).toHaveCount(0);
      assert.deepEqual(await vibrations(), [], "Right swipe must not request vibration");
      await touch(page, bubble, -80, 0);
      await expect(cancelReply).toBeAttached();
      assert.deepEqual(await vibrations(), [8], "A successful swipe reply must request one 8 ms vibration");
      console.log(mode, "left swipe passed");
      await tap(page, cancelReply);
      await expect(cancelReply).toHaveCount(0);
      await touch(page, bubble, -35, 0);
      await expect(cancelReply).toHaveCount(0);
      await touch(page, bubble, -15, -100);
      await expect(cancelReply).toHaveCount(0);
      assert.deepEqual(await vibrations(), [8], "Short and vertical swipes must not request vibration");
      await expect(reply).toHaveCount(0);
      const latest = native.getByRole("button", { name: "最新のメッセージへ", exact: true });
      await touch(page, bubble, 0, 220);
      await expect(latest).toBeAttached();
      await tap(page, latest);
      await expect(latest).toHaveCount(0);

      await touch(page, bubble, 0, 0, 900);
      await tap(page, native.getByRole("button", { name: "いいね", exact: true }));
      const reaction = native.getByRole("button", { name: "いいね 1件", exact: true });
      await expect(reaction).toBeAttached();
      await tap(page, reaction);
      await expect(reaction).toHaveCount(0);

      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(native.getByRole("button", { name: "サイドバーを閉じる", exact: true })).toBeAttached();
      const contextPoint = await center(bubble);
      await page.mouse.click(contextPoint.x, contextPoint.y, { button: "right" });
      await expect(reply).toBeAttached();
      await page.keyboard.press("Escape");
      await expect(reply).toHaveCount(0);
      const memberProfile = native.getByRole("button", { name: "あおいのプロフィール", exact: true }).first();
      await tap(page, memberProfile);
      const memberDialog = page.getByRole("dialog", { name: "あおい のプロフィール", exact: true });
      await expect(memberDialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(memberDialog).toHaveCount(0);
      await patchMessage(page, { status: "sending" });
      await touch(page, bubble, 0, 0, 900);
      for (const name of ["いいね", "再送信", "編集", "送信を取り消す", "既読者を確認"])
        await expect(native.getByRole("button", { name, exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(reply).toHaveCount(0);
      await patchMessage(page, { status: "failed" });
      await touch(page, bubble, 0, 0, 900);
      await expect(native.getByRole("button", { name: "再送信", exact: true })).toHaveCount(0);
      await expect(native.getByRole("button", { name: "いいね", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(reply).toHaveCount(0);
      await patchMessage(page, { status: "read" });
      await touch(page, bubble, 0, 0, 900);
      await expect(reply).toBeAttached();
      await patchMessage(page, { messageState: "revoked-by-other", text: "取り消されたメッセージ" });
      await expect(reply).toHaveCount(0);
      await tap(page, native.getByRole("button", { name: /^元のメッセージは保存されていません / }).first());
      await expect(native.getByRole("button", { name: "詳細・その他の操作", exact: true })).toBeAttached();
      for (const name of ["返信", "いいね", "コピー", "編集", "送信を取り消す"])
        await expect(native.getByRole("button", { name, exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(native.getByRole("button", { name: "詳細・その他の操作", exact: true })).toHaveCount(0);
      await patchMessage(page, { messageState: "normal", text: "個人情報を含まない安全なPRデモです。" });

      const link = `${base}/pr-demo#message-link`;
      await patchMessage(page, { text: link });
      // Compose LinkAnnotation exposes its hit target as a child button in Wasm.
      const linkControl = native.getByRole("button", { name: link, exact: true }).getByRole("button");
      await expect(linkControl).toBeAttached();
      const vibrationsBeforeLinkSwipe = await vibrations();
      await touch(page, linkControl, -80, 0);
      await expect(cancelReply).toHaveCount(0);
      assert.deepEqual(await vibrations(), vibrationsBeforeLinkSwipe, "A link-origin swipe must not request vibration");
      const popupEvent = page.waitForEvent("popup");
      await tap(page, linkControl);
      const popup = await popupEvent;
      assert(popup.url().includes("/pr-demo#message-link"));
      await popup.close();
      await page.bringToFront();
      await expect(reply).toHaveCount(0);
      await patchMessage(page, { text: "個人情報を含まない安全なPRデモです。" });
      console.log(mode, "capability, revoke, link passed");
      await page.waitForTimeout(400);
      const afterContentLatest = native.getByRole("button", { name: "最新のメッセージへ", exact: true });
      if (await afterContentLatest.count()) await tap(page, afterContentLatest);
      console.log(mode, "profile passed");
      await page.evaluate(async () => {
        const loaded = (suffix: string) => performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === suffix)?.name;
        const storePath = loaded("/src/lib/store.ts");
        const eventsPath = loaded("/src/lib/appEvents.ts");
        if (!storePath || !eventsPath) throw new Error("Loaded store/event modules required");
        const { useStore } = await import(storePath);
        const state = useStore.getState();
        if (!state.demoMode || state.accountId !== null) throw new Error("Account-free demo required");
        const original = state.messages.find((message: any) => message.id === "demo-message-1");
        useStore.setState({ messages: [
          ...Array.from({ length: 40 }, (_, index) => ({ ...original, id: `touch-history-${index}`, text: `過去のメッセージ ${index}`, createdAt: original.createdAt - (40 - index) * 60_000 })),
          ...state.messages,
        ] });
        (await import(eventsPath)).emitAppEvent("history:state", { chatMid: "demo-chat-team", loading: false, hasMore: true });
        (window as any).kmpMessageActions = [];
        useStore.setState({ highlightMessageId: "touch-history-0" });
      });
      const oldest = native.getByRole("button", { name: "過去のメッセージ 0", exact: true });
      await expect(oldest).toBeAttached();
      const olderActions = () => page.evaluate(() => (window as any).kmpMessageActions.filter((item: any) => item.action === "load-older").length);
      await page.waitForTimeout(400);
      assert.equal(await olderActions(), 0, "Programmatic message jump must not fetch history");
      const historyLatest = native.getByRole("button", { name: "最新のメッセージへ", exact: true });
      await tap(page, historyLatest);
      await expect(historyLatest).toHaveCount(0);
      const historyBounds = await native.getByRole("list", { name: "メッセージ履歴", exact: true }).boundingBox();
      assert(historyBounds);
      await page.mouse.move(historyBounds.x + historyBounds.width / 2, historyBounds.y + historyBounds.height / 2);
      await page.mouse.wheel(0, -100_000);
      await expect.poll(olderActions).toBe(1);
      await page.mouse.wheel(0, -1000);
      await page.waitForTimeout(300);
      assert.equal(await olderActions(), 1, "Staying at the boundary must not request repeatedly");
      const beforePrepend = await oldest.boundingBox();
      assert(beforePrepend);
      await page.evaluate(async () => {
        const path = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")!.name;
        const { useStore } = await import(path);
        const state = useStore.getState();
        if (!state.demoMode || state.accountId !== null) throw new Error("Account-free demo required");
        const oldest = state.messages.find((message: any) => message.id === "touch-history-0");
        useStore.setState({ messages: [{ ...oldest, id: "touch-history-prepended", text: "追加取得された過去のメッセージ", createdAt: oldest.createdAt - 60_000 }, ...state.messages] });
      });
      await page.waitForTimeout(300);
      const afterPrepend = await oldest.boundingBox();
      assert(afterPrepend && Math.abs(afterPrepend.y - beforePrepend.y) < 3, "Prepending history must retain the visible message position");
      await patchMessage(page, { text: "末尾の本文が更新されても過去を読む位置を保ちます。" });
      await page.waitForTimeout(300);
      const afterUpdate = await oldest.boundingBox();
      assert(afterUpdate && Math.abs(afterUpdate.y - afterPrepend.y) < 3, "Updating the last message must not move a reader in history");
      await tap(page, historyLatest);
      await expect(historyLatest).toHaveCount(0);
      const updatedLast = native.getByRole("button", { name: "末尾の本文が更新されても過去を読む位置を保ちます。", exact: true });
      await patchMessage(page, { text: "末尾を表示中の長い本文更新も追従します。\n2行目の本文です。\n3行目の本文です。\n4行目の本文です。\n5行目の本文です。\n6行目の本文です。\n7行目の本文です。\n8行目の本文です。" });
      await expect(updatedLast).toHaveCount(0);
      await expect(historyLatest).toHaveCount(0);
      await expect.poll(lastReaderAboveComposer).toBe(true);
      const composer = native.getByRole("textbox", { name: "メッセージを入力", exact: true });
      await tap(page, composer);
      await page.keyboard.insertText("送信しない入力確認\n2行目\n3行目\n4行目\n5行目");
      await expect(historyLatest).toHaveCount(0);
      await expect.poll(lastReaderAboveComposer).toBe(true);
      console.log(mode, "history boundary and anchoring passed");
      await native.locator("body").evaluate(() => {
        const audit = (window as any).messageKeyboardAudit = { pointer: [] as object[], key: [] as object[] };
        const active = () => { let element = document.activeElement; while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
          return { tag: element?.tagName, role: element?.getAttribute("role"), label: element?.getAttribute("aria-label") }; };
        document.addEventListener("pointerdown", (event) => audit.pointer.push({ path: event.composedPath().map((node) => (node as HTMLElement).tagName).filter(Boolean), active: active() }), true);
        document.addEventListener("keydown", (event) => audit.key.push({ key: event.key, active: active() }), true);
      });
      const point = await center(native.getByRole("button", { name: /^末尾を表示中の長い本文更新も追従します。/ }));
      await page.mouse.click(point.x, point.y);
      await page.keyboard.press("Shift+F10");
      await expect(reply).toBeAttached();
      // Repeated Tab must stay in the modal instead of reaching the composer.
      for (let index = 0; index < 20; index++) await page.keyboard.press("Tab");
      await expect(reply).toBeAttached();
      for (let index = 0; index < 20; index++) await page.keyboard.press("Shift+Tab");
      await expect(reply).toBeAttached();
      await page.keyboard.press("Escape");
      await expect(reply).toHaveCount(0);
      await page.screenshot({ path: resolve(output, `${mode}-touch.png`) });
      assert.deepEqual(errors, []);
      results.push({ mode,
        touch: "tap, double tap, long press, outside dismissal, left/right/short/vertical swipe, latest, reaction toggle, profile passed",
        keyboard: "right click, Shift+F10, 20x Tab, 20x Shift+Tab, Escape passed",
        state: "sending/failed capabilities, revoked open menu dismissal, revoked detail-only menu passed",
        links: "touch opens a popup; link-origin swipe never replies",
        haptics: { swipe: "one 8 ms request for successful reply; none for right/short/vertical/link swipe", longPressVibrations, physical: "unverified" },
        history: "programmatic jump does not load; user boundary loads once; prepend retains bubble; last message update retains history reading position; end follows resized text/composer",
        network: "account-free demo only; no LINE requests",
        actions: await page.evaluate(() => (window as any).kmpMessageActions.map((action: any) => action.action)) });
    } catch (error) {
      console.log("failure actions", await page.evaluate(() => (window as any).kmpMessageActions));
      console.log("failure keyboard focus", await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").evaluate(() => (window as any).messageKeyboardAudit ?? null));
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      await writeFile(resolve(output, `${mode}-failure.txt`), `${String(error)}\n${await page.frameLocator('iframe[title="Vyline Compose UI"]').locator('body').ariaSnapshot()}`);
      failures.push({ mode, error: String(error) });
    } finally { await page.close(); }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  assert.deepEqual(failures, [], "Every theme must pass the same interaction checks");
} finally { await browser.close(); }
