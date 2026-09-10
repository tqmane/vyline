import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

// Supplemental acceptance, not a replacement for the existing parity/layout suites.
// Vite /pr-demo only: reads the already-loaded product store, never creates an
// account or injects Kotlin state. Every interaction uses the real canvas pointer.
const base = new URL(process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173");
assert(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Use a local Vite server");
assert(["http:", "https:"].includes(base.protocol) && !base.username && !base.password);
assert(base.pathname === "/" && !base.search && !base.hash, "VYLINE_TEST_URL must be an origin");
const output = resolve(import.meta.dir, process.env.VYLINE_TEST_OUTPUT ?? `../test-results/theme-fidelity/${Date.now()}`);
const iframeSelector = 'iframe[title="Vyline Compose UI"]';
const modes = ["apple", "fluent", "miuix"] as const;
type Mode = (typeof modes)[number];
type Appearance = "light" | "dark";
const names: Record<Mode, string> = { apple: "Messages", fluent: "Fluent", miuix: "Miuix" };
const desktop = { width: 1440, height: 1000 };
const phone = { width: 390, height: 844 };
const draft = "切り替えても保持する下書き\n送信しない確認";
const messageText = "個人情報を含まない安全なPRデモです。";

async function bounds(page: Page, locator: Locator) {
  await expect(locator).toBeAttached();
  let previous = "";
  let stable = 0;
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const current = JSON.stringify(box);
    stable = box && current === previous ? stable + 1 : 0;
    previous = current;
    const viewport = page.viewportSize()!;
    return stable >= 3 && !!box && box.width > 0 && box.height > 0 &&
      box.x >= -1 && box.y >= 0 && box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1;
  }, { timeout: 10_000, intervals: [150] }).toBe(true);
  const box = await locator.boundingBox();
  assert(box, "Native control needs stable, on-screen semantic bounds");
  return box;
}

async function click(page: Page, locator: Locator, button: "left" | "right" = "left") {
  const box = await bounds(page, locator);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button });
}

async function readDemo(page: Page) {
  return page.evaluate(async () => {
    if (location.pathname !== "/pr-demo") throw new Error("Only /pr-demo is allowed");
    const path = performance.getEntriesByType("resource").map(entry => entry.name)
      .findLast(url => new URL(url).pathname === "/src/lib/store.ts");
    if (!path) throw new Error("Loaded Vite store module required; production preview is not supported");
    const { useStore, formatTime } = await import(path);
    const state = useStore.getState();
    if (!state.demoMode || state.accountId !== null) throw new Error("Account-free demo required");
    const controllerPath = performance.getEntriesByType("resource").map(entry => entry.name)
      .findLast(url => new URL(url).pathname === "/src/ui/composer-controller.ts");
    if (!controllerPath) throw new Error("Loaded composer controller module required");
    const { getComposerController } = await import(controllerPath);
    const composer = getComposerController(state.activeChatId)?.snapshot;
    if (!composer || composer.accountId !== null) throw new Error("Account-free composer required");
    const message = state.messages.find((item: { id: string }) => item.id === "demo-message-4");
    if (!message?.readByAt) throw new Error("Expected representative demo message and reader times");
    return {
      selection: { start: composer.selectionStart as number, end: composer.selectionEnd as number },
      activeChatId: state.activeChatId as string | null,
      replyToId: state.replyToId as string | null,
      time: formatTime(message.createdAt) as string,
      messageCount: state.messages.length as number,
      reactions: (message.reactions ?? []) as { fromMid: string; type: number }[],
      readers: ["demo-alice", "demo-bob"].map((id, index) => ({
        name: ["あおい", "れん"][index]!,
        time: new Intl.DateTimeFormat("ja-JP", {
          month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
        }).format(new Date(message.readByAt[id])),
      })),
    };
  });
}

await mkdir(output, { recursive: true });
console.log(`Artifacts: ${output}`);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
let stage = "startup";
let currentCase = "initial";
const errors: string[] = [];
const blockedRequests: string[] = [];
const apiRequests: string[] = [];
const fixtureRequests: string[] = [];
const reactionAssetUrl = new URL(`/api/cdn/line?u=${encodeURIComponent(
  "https://stickershop.line-scdn.net/sticonshop/v1/sticon/670e0cce840a8236ddd4ee4c/android/143.png",
)}`, base).href;
const hostFontUrl = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap";
const frameNavigations: string[] = [];
let monitorFrame = false;
let completed = false;
const context = await browser.newContext({ viewport: desktop, deviceScaleFactor: 2,
  locale: "ja-JP", timezoneId: "Asia/Tokyo", serviceWorkers: "block" });
const page = await context.newPage();
try {
  page.on("pageerror", error => errors.push(error.message));
  page.on("framenavigated", frame => {
    if (monitorFrame && (frame.parentFrame() === page.mainFrame() || frame === page.mainFrame()))
      frameNavigations.push(frame.url());
  });
  // A fresh context has no login storage. Also prevent any API/remote traffic
  // from leaving the browser. Unexpected API attempts are a failure, not a stub pass.
  await context.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    // The hidden shared React renderer requests this reaction artwork too.
    // Fixture only this known asset; no network proxy or account API is allowed.
    if (request.method() === "GET" && request.resourceType() === "image" && url.href === reactionAssetUrl) {
      fixtureRequests.push(`synthetic-reaction-image ${url.href}`);
      return route.fulfill({ status: 200, contentType: "image/svg+xml",
        path: resolve(import.meta.dir, "../public/demo/sticker-ok.svg") });
    }
    if (request.method() === "GET" && request.resourceType() === "stylesheet" && url.href === hostFontUrl) {
      fixtureRequests.push(`host-font-fallback ${url.href}`);
      return route.fulfill({ status: 200, contentType: "text/css",
        body: "/* Offline host font fallback. Compose retains its local bundled fonts. */" });
    }
    if (url.pathname.startsWith("/api/")) {
      apiRequests.push(`${request.method()} ${url.href}`);
      return route.abort();
    }
    if (url.origin !== base.origin) {
      blockedRequests.push(`${request.method()} ${url.href}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(() => localStorage.setItem("vyline:design-system",
    JSON.stringify({ state: { mode: "apple", appearance: "light" }, version: 0 })));
  await page.goto(`${base.origin}/pr-demo`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
  const native = page.frameLocator(iframeSelector);
  const button = (name: string) => native.getByRole("button", { name, exact: true });
  const editor = native.getByRole("textbox", { name: "メッセージを入力", exact: true });
  const hostEditor = page.locator('.vy-react-renderer textarea[aria-label="メッセージを入力"]');
  await expect(editor).toBeAttached();
  await expect(page.locator(iframeSelector)).toHaveCount(1);
  const originalIframe = await page.locator(iframeSelector).elementHandle();
  const originalDocument = await page.locator(iframeSelector).evaluateHandle((node: HTMLIFrameElement) => node.contentDocument);
  const originalComposer = await hostEditor.elementHandle();
  assert(originalIframe && originalComposer);
  monitorFrame = true;
  const initial = await readDemo(page);
  assert.equal(initial.activeChatId, "demo-chat-team");

  stage = "create unsent draft and reply selection";
  await click(page, button(messageText), "right");
  await click(page, button("返信"));
  await expect(button("返信をキャンセル")).toBeAttached();
  await click(page, editor);
  await page.keyboard.insertText(draft.split("\n")[0]!);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText(draft.split("\n")[1]!);
  await expect(hostEditor).toHaveValue(draft);
  assert.equal((await readDemo(page)).replyToId, "demo-message-4");
  // Create a forward range using real keys. Reverse ranges are normalized by
  // the host bridge, so they are a separate, explicitly unverified acceptance item.
  const selection = { start: draft.indexOf("\n") + 1, end: draft.indexOf("\n") + 5 };
  const selectWithKey = async (key: string, end: number) => {
    await page.keyboard.press(key);
    // Compose's controlled TextFieldValue reaches the input handler on a render
    // frame. A zero-delay key burst can reuse the previous range for every key.
    await editor.evaluate(() => new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(async () => (await readDemo(page)).selection)
      .toEqual({ start: selection.start, end });
  };
  await selectWithKey("Home", selection.start);
  for (let index = 1; index <= 4; index++)
    await selectWithKey("Shift+ArrowRight", selection.start + index);

  const retained = async () => {
    const state = await readDemo(page);
    assert.equal(state.activeChatId, initial.activeChatId, "Selected conversation survives presentation changes");
    assert.equal(state.replyToId, "demo-message-4", "Reply selection survives presentation changes");
    assert.deepEqual(state.selection, selection, "Composer forward selection survives presentation changes");
    assert.equal(state.messageCount, initial.messageCount, "Draft must never be sent");
    await expect(hostEditor).toHaveValue(draft);
    assert(await originalComposer.evaluate(node => node.isConnected), "Product composer was remounted");
    assert(await originalIframe.evaluate(node => node.isConnected && node === document.querySelector('iframe[title="Vyline Compose UI"]')),
      "Compose iframe element was replaced");
    assert(await page.locator(iframeSelector).evaluate((node: HTMLIFrameElement, original) => node.contentDocument === original, originalDocument),
      "Compose iframe document/runtime was reloaded");
    await expect(page.locator(iframeSelector)).toHaveCount(1);
    assert.deepEqual(frameNavigations, [], "Theme switching must not navigate/reload the runtime");
    assert.deepEqual(apiRequests, [], "Synthetic checks must not attempt unfixtureed API requests");
    assert.deepEqual(blockedRequests, [], "Synthetic checks must not attempt unfixtureed external requests");
    assert.deepEqual(errors, [], "No browser runtime exceptions");
  };
  const screenshot = async (name: string) => {
    // Native animation/AX settle; screenshots are review evidence, not pixel goldens.
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(output, `${currentCase}-${name}.png`) });
  };
  const openSettings = async () => {
    await click(page, button("設定").first());
    await expect(button("設定を閉じる")).toBeAttached();
    await expect(native.getByText("Vyline Classic", { exact: true })).toBeAttached();
  };
  const closeSettings = async () => {
    await click(page, button("設定を閉じる"));
    await expect(editor).toBeAttached();
    await retained();
  };
  const reachByScrolling = async (target: Locator, panel = false) => {
    await expect(target).toBeAttached();
    for (let attempt = 0; attempt < 12; attempt++) {
      // AX geometry can lag a native scroll by up to a second.
      await page.waitForTimeout(1100);
      const box = await target.boundingBox();
      if (box && box.height > 0 && box.y >= 100 && box.y + box.height < desktop.height - 20)
        return bounds(page, target);
      const list = panel ? await native.getByRole("list").last().boundingBox() : null;
      await page.mouse.move(list ? list.x + list.width - 15 : desktop.width - 100,
        list ? list.y + list.height / 2 : desktop.height / 2);
      await page.mouse.wheel(0, box && box.height > 0 && box.y < 100 ? -450 : 450);
    }
    throw new Error(`Native settings control not reachable: ${await target.innerText()}`);
  };

  // A continuous six-cell traversal catches mode-switch remounts. No page reload
  // or store setter is used to switch appearance/mode or restore a lost draft.
  let mode: Mode = "apple";
  let appearance: Appearance = "light";
  for (const targetMode of modes) {
    for (const targetAppearance of ["light", "dark"] as const) {
      currentCase = `${targetMode}-${targetAppearance}`;
      stage = "switch theme through native settings";
      if (mode !== targetMode || appearance !== targetAppearance) {
        await openSettings();
        if (mode !== targetMode) await click(page, native.getByText(names[targetMode], { exact: true }));
        if (appearance !== targetAppearance) await click(page, button(targetAppearance === "light" ? "ライト" : "ダーク"));
        mode = targetMode;
        appearance = targetAppearance;
        await closeSettings();
      }
      await expect(page.locator("html")).toHaveAttribute("data-ui-mode", targetMode);
      await expect(page.locator("html")).toHaveAttribute("data-appearance", targetAppearance);
      await retained();
      await bounds(page, editor);
      await expect(button("返信をキャンセル")).toBeAttached();
      stage = "message timestamps and reader metadata";
      const fixture = await readDemo(page);
      await expect(native.getByText(fixture.time, { exact: true }).first()).toBeAttached();
      await screenshot("desktop-chat");
      await click(page, button("既読者一覧 2人").last());
      for (const reader of fixture.readers) {
        await bounds(page, button(`${reader.name}、${reader.time}、プロフィールを開く`));
      }
      await screenshot("readers");
      await page.keyboard.press("Escape");
      await expect(button("既読一覧を閉じる")).toHaveCount(0);

      stage = "reaction menu and local toggle";
      await click(page, button(messageText), "right");
      for (const label of ["返信", "コピー", "編集", "送信を取り消す", "詳細・その他の操作", "いいね", "ハート", "笑い", "驚き", "悲しい", "びっくり"])
        await expect(button(label)).toBeAttached();
      await screenshot("message-menu");
      await click(page, button("いいね"));
      const reaction = button("いいね 1件");
      await expect(reaction).toBeAttached();
      await expect.poll(async () => (await readDemo(page)).reactions.filter(item => item.type === 2).length).toBe(1);
      await screenshot("reaction");
      await click(page, reaction);
      await expect(reaction).toHaveCount(0);
      await expect.poll(async () => (await readDemo(page)).reactions.length).toBe(0);
      await retained();

      stage = "native settings evidence";
      await openSettings();
      await screenshot("settings");
      stage = "accountless destructive controls: presence only";
      const advanced = button("アカウント・バックアップ・詳細設定");
      await reachByScrolling(advanced);
      await click(page, advanced);
      const advancedTab = native.getByRole("tab", { name: "詳細・復元", exact: true });
      await click(page, advancedTab);
      const cache = button("キャッシュを削除して再読み込み");
      await reachByScrolling(cache, true);
      await screenshot("settings-cache");
      // Cache executes immediately and reloads: do not click it, even in demo.
      const reset = button("初期化");
      await reachByScrolling(reset, true);
      await screenshot("settings-reset");
      await retained();
      await click(page, button("閉じる"));
      await expect(advancedTab).toHaveCount(0);
      await closeSettings();

      stage = "phone layout retains state";
      await page.setViewportSize(phone);
      await retained();
      // Resizing preserves the history anchor, not a forced jump to the end.
      // Exercise the existing latest-message action before testing bottom-row reachability.
      const latest = button("最新のメッセージへ");
      await bounds(page, editor);
      if (await latest.count()) await click(page, latest);
      const composerBounds = await bounds(page, editor);
      await bounds(page, button("既読者一覧 2人").last());
      const readerBounds = await button("既読者一覧 2人").last().boundingBox();
      assert(readerBounds && readerBounds.y + readerBounds.height <= composerBounds.y,
        "Reader affordance must not overlap the composer");
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await retained();
      await screenshot("phone-chat");
      await page.setViewportSize(desktop);
      await bounds(page, editor);
      results.push({ mode, appearance, status: "passed", selectedChat: initial.activeChatId,
        replySelection: "demo-message-4", composerSelection: selection, retainedDraft: true, retainedComposer: true,
        retainedIframeElementAndDocument: true, messageTime: fixture.time, readers: fixture.readers,
        reactionToggle: true, destructiveControls: "cache/reset presence only; never invoked", viewportChecks: [desktop, phone],
        screenshots: ["desktop-chat", "readers", "message-menu", "reaction", "settings", "settings-cache", "settings-reset", "phone-chat"].map(name => `${currentCase}-${name}.png`) });
      console.log(`${currentCase}: focused fidelity assertions passed`);
    }
  }
  await retained();
  completed = true;
} catch (error) {
  await page.screenshot({ path: resolve(output, `${currentCase}-failure.png`) }).catch(() => undefined);
  const semantics = await page.frameLocator(iframeSelector).locator("body").ariaSnapshot().catch(() => "Native semantics unavailable");
  await writeFile(resolve(output, `${currentCase}-failure.txt`), `${stage}\n${String(error)}\n${semantics}`);
  throw error;
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({
    status: completed ? "passed" : "failed", base: base.origin, stage, cases: results,
    errors, apiRequests, blockedRequests, fixtureRequests, frameNavigations,
    scope: "Synthetic accountId=null; one exact reaction image fixture; host font stylesheet uses offline fallback, not IBM Plex verification; Compose fonts unchanged; visual fidelity requires review; not full functional parity",
  }, null, 2));
  await context.close();
  await browser.close();
}
