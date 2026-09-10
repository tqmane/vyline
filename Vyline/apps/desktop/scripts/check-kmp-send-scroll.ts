import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

// UNVERIFIED until explicitly run against the parent's ready Vite + actual Wasm build.
// Accountless integration only: native input/send -> loaded host store -> true footer end.
const base = new URL(process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5186");
assert(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Loopback only");
assert(["http:", "https:"].includes(base.protocol) && !base.username && !base.password);
assert(base.pathname === "/" && !base.search && !base.hash, "Use a local Vite origin");
const output = resolve(import.meta.dir, process.env.VYLINE_TEST_OUTPUT ?? `../test-results/kmp-send-scroll/${Date.now()}`);
const viewport = process.env.VYLINE_TEST_VIEWPORT === "desktop" ? { width: 1440, height: 1000 } : { width: 390, height: 844 };
const selector = 'iframe[title="Vyline Compose UI"]';
const fontUrl = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap";
const reactionUrl = new URL(`/api/cdn/line?u=${encodeURIComponent("https://stickershop.line-scdn.net/sticonshop/v1/sticon/670e0cce840a8236ddd4ee4c/android/143.png")}`, base).href;
async function nativeClick(page: Page, locator: Locator) {
  await expect(locator).toBeAttached();
  let previous = "";
  let stable = 0;
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const current = JSON.stringify(box);
    stable = box && current === previous ? stable + 1 : 0; previous = current;
    const view = page.viewportSize()!;
    return stable >= 3 && !!box && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 &&
      box.x + box.width <= view.width + 1 && box.y + box.height <= view.height + 1;
  }, { timeout: 10_000, intervals: [150] }).toBe(true);
  const box = await locator.boundingBox(); assert(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
let completed = false;
try {
  for (const mode of ["apple", "fluent", "miuix"] as const) for (const appearance of ["light", "dark"] as const) {
    const name = `${mode}-${appearance}`;
    const blocked: string[] = [];
    const fixtures: string[] = [];
    const failures: string[] = [];
    const wasm: string[] = [];
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "ja-JP", serviceWorkers: "block" });
    context.setDefaultTimeout(10_000); context.setDefaultNavigationTimeout(30_000);
    await context.exposeBinding("__sendScrollForbidden", (_source, value: string) => { failures.push(value); });
    await context.route("**/*", route => {
      const request = route.request();
      const url = new URL(request.url());
      // Exact offline exceptions only; neither fixture reaches an API or the Internet.
      if (request.method() === "GET" && request.resourceType() === "image" && url.href === reactionUrl) {
        fixtures.push("offline reaction");
        return route.fulfill({ contentType: "image/svg+xml", path: resolve(import.meta.dir, "../public/demo/sticker-ok.svg") });
      }
      if (request.method() === "GET" && request.resourceType() === "stylesheet" && url.href === fontUrl) {
        fixtures.push("offline font fallback"); return route.fulfill({ contentType: "text/css", body: "/* Offline fallback */" });
      }
      if (request.method() !== "GET" || url.origin !== base.origin || /^\/api(?:\/|$)/i.test(url.pathname)) {
        blocked.push(`${request.method()} ${url.href}`); return route.abort();
      }
      return route.continue();
    });
    await context.routeWebSocket("**/*", socket => {
      const url = new URL(socket.url());
      if (url.host === base.host && url.protocol === (base.protocol === "https:" ? "wss:" : "ws:") && url.pathname === "/") socket.connectToServer();
      else { blocked.push(`WebSocket ${url.href}`); socket.close(); }
    });
    await context.addInitScript(({ mode, appearance, origin }) => {
      const target = window as any;
      localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance }, version: 0 }));
      target.__sendScrollAudit = { epoch: null, chatId: null, counters: {}, actions: [], attempts: [] };
      const audit = target.__sendScrollAudit;
      // Ordinary constructible function: records both function and `new` attempts.
      const blocked = (name: string) => {
        function forbidden() {
          audit.attempts.push(name); void target.__sendScrollForbidden(name); throw new Error(`Forbidden: ${name}`);
        }
        return forbidden;
      };
      for (const name of ["getUserMedia", "getDisplayMedia", "enumerateDevices"])
        if (navigator.mediaDevices && name in navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, name, { value: blocked(name) });
      for (const name of ["getUserMedia", "webkitGetUserMedia", "mozGetUserMedia"])
        if (name in navigator) Object.defineProperty(navigator, name, { value: blocked(name) });
      for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "MediaRecorder"])
        if (name in target) target[name] = blocked(name);
      const Socket = target.WebSocket;
      target.WebSocket = class extends Socket {
        constructor(address: string | URL, protocols?: string | string[]) {
          const url = new URL(String(address), location.href);
          const list = typeof protocols === "string" ? [protocols] : protocols;
          if (url.origin !== origin.replace(/^http/, "ws") || url.pathname !== "/" || list?.length !== 1 || list[0] !== "vite-hmr") blocked(`WebSocket ${url.href}`)();
          super(address, protocols);
        }
      };
      if (window !== parent && location.pathname === "/dist/ui-compose/index.html") {
        // Pre-main startup opt-in only. No reload, iframe src edit, DOM mutation or injected rows.
        const url = new URL(location.href); url.searchParams.set("selftest", "1"); history.replaceState(history.state, "", url);
      }
      window.addEventListener("message", event => {
        if (event.origin !== origin) return;
        let value = event.data;
        try { if (typeof value === "string") value = JSON.parse(value); } catch { return; }
        if (value?.channel !== "vyline-ui" || value.version !== 1) return;
        if (window !== parent && event.source === parent && ["snapshot", "patch"].includes(value.type)) {
          if (value.epoch !== undefined && value.epoch !== audit.epoch) { audit.epoch = value.epoch; audit.counters = {}; }
          if (value.chat !== undefined) audit.chatId = value.chat?.id ?? null;
          if (typeof value.scrollLatest === "number") audit.counters[audit.chatId] = value.scrollLatest;
          for (const pane of value.panes ?? []) if (typeof pane.scrollLatest === "number") audit.counters[pane.id] = pane.scrollLatest;
          for (const [id, pane] of Object.entries(value.panePatches ?? {}) as [string, any][])
            if (typeof pane.scrollLatest === "number") audit.counters[id] = pane.scrollLatest;
        } else if (window === parent && event.source === document.querySelector<HTMLIFrameElement>('iframe[title="Vyline Compose UI"]')?.contentWindow && value.action) {
          audit.actions.push({ action: value.action, epoch: value.epoch, chatId: value.chatId });
        }
      });
    }, { mode, appearance, origin: base.origin });
    const page = await context.newPage();
    page.on("pageerror", error => failures.push(error.message));
    page.on("dialog", dialog => { failures.push(`Unexpected ${dialog.type()}`); void dialog.dismiss(); });
    page.on("response", response => { if (response.ok() && new URL(response.url()).pathname.endsWith(".wasm")) wasm.push(response.url()); });
    let stage = "load";
    let evidence: unknown = null;
    const deadline = setTimeout(() => { failures.push("Case exceeded 120 seconds"); void context.close(); }, 120_000);
    const diagnostics = async () => ({
      audit: await page.evaluate(() => (window as any).__sendScrollAudit).catch(() => null),
      frames: await Promise.all(page.frames().map(frame => frame.evaluate(() => ({ url: location.href,
        audit: (window as any).__sendScrollAudit, timelines: (window as any).__vylineTimelines })).catch(() => null))),
      store: await page.evaluate(() => (window as any).__sendScrollRead?.()).catch(() => null),
    });
    try {
      await page.goto(`${base.origin}/pr-demo?stress=90`, { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const iframe = page.locator(selector);
      const native = page.frameLocator(selector);
      const original = await iframe.elementHandle(); assert(original);
      const document = await iframe.evaluateHandle((node: HTMLIFrameElement) => node.contentDocument);
      const frame = await original.contentFrame(); assert(frame);
      page.on("framenavigated", () => failures.push("Unexpected navigation after ready"));
      await expect(iframe).toHaveAttribute("src", "/dist/ui-compose/index.html");
      assert(new URL(frame.url()).searchParams.has("selftest"));
      await expect(page.locator("html")).toHaveAttribute("data-ui-mode", mode);
      await expect(page.locator("html")).toHaveAttribute("data-appearance", appearance);
      assert(new Set(wasm).size >= 2, "Application Wasm and Skiko Wasm must actually load");
      await page.evaluate(async () => {
        const path = performance.getEntriesByType("resource").map(entry => entry.name).findLast(url => new URL(url).pathname === "/src/lib/store.ts");
        if (!path) throw new Error("Already-loaded Vite store required");
        const { useStore } = await import(path);
        (window as any).__sendScrollRead = () => {
          const state = useStore.getState();
          if (location.pathname !== "/pr-demo" || state.demoMode !== true || state.accountId !== null || state.callRequest !== null) throw new Error("Accountless call-free demo required");
          return { chatId: state.activeChatId, draft: state.drafts[state.activeChatId] ?? "",
            messages: state.messages.filter((message: any) => message.chatId === state.activeChatId).map(({ id, text, authorId }: any) => ({ id, text, authorId })) };
        };
      });
      const read = () => page.evaluate(() => (window as any).__sendScrollRead());
      const before = await read(); assert(before.chatId && before.messages.length >= 90);
      const sample = () => frame.evaluate(id => { const audit = (window as any).__sendScrollAudit;
        return { epoch: audit.epoch, counter: audit.counters[id], timeline: (window as any).__vylineTimelines?.[`${audit.epoch}:${id}`] ?? null }; }, before.chatId);
      const atEnd = async (id: string) => { const { epoch, timeline: t } = await sample();
        return !!t && t.epoch === epoch && t.chatId === before.chatId && t.paneId === before.chatId && t.expectedLastKey === id && t.lastKey === id &&
          t.lastIndex === t.totalItemsCount - 1 && !t.canScrollForward && !t.isScrollInProgress && t.lastOffset + t.lastSize + t.afterContentPadding <= t.viewportEndOffset + 1; };
      await expect.poll(() => atEnd(before.messages.at(-1).id), { timeout: 15_000 }).toBe(true);
      const initial = await sample(); assert(Number.isInteger(initial.counter), "Observe the real host scroll counter");
      const editor = native.getByRole("textbox", { name: "メッセージを入力", exact: true });
      const hostEditor = page.locator('.vy-react-renderer textarea[aria-label="メッセージを入力"]');
      await expect(hostEditor).toHaveCount(1); await expect(hostEditor).toHaveValue("");
      const noAcceptance = async () => { await page.waitForTimeout(350); assert.deepEqual((await read()).messages, before.messages); assert.equal((await sample()).counter, initial.counter); };
      stage = "empty Enter / Shift+Enter rejected";
      await nativeClick(page, editor); await page.keyboard.press("Enter"); await noAcceptance();
      // Phone Enter inserts a newline; clear that draft before the independent Shift+Enter case.
      await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.press("Backspace"); await expect(hostEditor).toHaveValue("");
      await page.keyboard.insertText("改行のみ"); await page.keyboard.press("Shift+Enter"); await expect(hostEditor).toHaveValue("改行のみ\n"); await noAcceptance();
      await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.press("Backspace"); await expect(hostEditor).toHaveValue("");
      stage = "long native draft from history";
      const text = Array.from({ length: 65 }, (_, index) => `${name} 長い送信 ${index + 1}`).join("\n");
      await page.keyboard.insertText(text); await expect(hostEditor).toHaveValue(text);
      const box = await editor.boundingBox(); assert(box);
      await page.mouse.move(box.x + box.width / 2, Math.min(box.y - 80, viewport.height * .45)); await page.mouse.wheel(0, -900);
      await expect.poll(async () => { const t = (await sample()).timeline; return t?.ownership === "history" && t.canScrollForward && !t.isScrollInProgress; }).toBe(true);
      await noAcceptance(); await read(); // Recheck accountless store immediately before native send.
      const sends = () => page.evaluate(() => (window as any).__sendScrollAudit.actions.filter((event: any) => event.action === "send").length);
      const sendsBefore = await sends();
      stage = "native Send -> accepted once -> actual last footer";
      await nativeClick(page, native.getByRole("button", { name: "送信", exact: true }));
      await expect(hostEditor).toHaveValue("");
      await expect.poll(async () => (await read()).messages.length).toBe(before.messages.length + 1);
      const after = await read();
      const added = after.messages.filter((message: any) => !before.messages.some((old: any) => old.id === message.id));
      assert.equal(after.chatId, before.chatId); assert.equal(after.draft, ""); assert.equal(added.length, 1);
      assert.equal(added[0].text, text); assert.equal(added[0].authorId, "me");
      await expect.poll(async () => (await sample()).counter).toBe(initial.counter + 1);
      await expect.poll(() => atEnd(added[0].id), { timeout: 15_000 }).toBe(true);
      const final = await sample(); assert(final.timeline.lastSize > final.timeline.viewportEndOffset - final.timeline.viewportStartOffset, "Final row must exceed the viewport");
      await page.waitForTimeout(400); assert.equal((await read()).messages.length, before.messages.length + 1); assert.equal((await sample()).counter, initial.counter + 1);
      assert.equal(await sends(), sendsBefore + 1); assert(await atEnd(added[0].id), "Footer must remain at true end");
      assert(await original.evaluate(node => node.isConnected), "Iframe remounted"); await expect(iframe).toHaveCount(1);
      assert(await iframe.evaluate((node: HTMLIFrameElement, old) => node.contentDocument === old, document), "Wasm document reloaded");
      evidence = { initial, final, addedId: added[0].id, ...(await diagnostics()) };
      assert.deepEqual(blocked, []); assert.deepEqual(failures, []);
      await page.screenshot({ path: resolve(output, `${name}-sent.png`) });
      results.push({ name, status: "passed", stage, wasm, blocked, fixtures, failures, evidence });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${name}-failure.png`) }).catch(() => undefined);
      evidence = await diagnostics();
      await writeFile(resolve(output, `${name}-failure-ax.txt`), await page.frameLocator(selector).locator("body").ariaSnapshot().catch(() => "Native semantics unavailable"));
      results.push({ name, status: "failed", stage, error: String(error), wasm, blocked, fixtures, failures, evidence }); throw error;
    } finally { clearTimeout(deadline); await context.close(); }
  }
  completed = true;
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ status: completed ? "passed" : "failed", base: base.origin, viewport, cases: results,
    scope: "Actual Wasm, accountless native send and numeric true-end; no backend, synthetic rows, manual scroll events or real IME claim. Screenshots require visual review." }, null, 2));
  await browser.close();
}
