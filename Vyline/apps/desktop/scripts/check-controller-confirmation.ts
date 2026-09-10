import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

// Slice 2b only: public controller promise in an accountless demo, never requestCall.
const base = new URL(process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5186");
assert(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname));
assert(["http:", "https:"].includes(base.protocol) && !base.username && !base.password);
assert(base.pathname === "/" && !base.search && !base.hash, "Use a local Vite origin");
const output = resolve(import.meta.dir, process.env.VYLINE_TEST_OUTPUT ?? `../test-results/controller-confirmation/${Date.now()}`);
const viewport = process.env.VYLINE_TEST_VIEWPORT === "phone"
  ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
const iframeSelector = 'iframe[title="Vyline Compose UI"]';
const text = "安全なデモ確認です。実際の通話は開始しません。";
const reactionUrl = new URL(`/api/cdn/line?u=${encodeURIComponent(
  "https://stickershop.line-scdn.net/sticonshop/v1/sticon/670e0cce840a8236ddd4ee4c/android/143.png",
)}`, base).href;
const fontUrl = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap";

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
    return stable >= 3 && !!box && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 &&
      box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  }, { timeout: 10_000, intervals: [150] }).toBe(true);
  const box = await locator.boundingBox(); assert(box);
  return box;
}
async function click(page: Page, locator: Locator) {
  const box = await bounds(page, locator);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

await mkdir(output, { recursive: true });
console.log(`Artifacts: ${output}`);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
const failures: string[] = [];
const fixtures: string[] = [];
let currentCase = "startup";
let stage = "startup";
let completed = false;
try {
  for (const mode of ["apple", "fluent", "miuix"] as const) for (const appearance of ["light", "dark"] as const) {
    currentCase = `${mode}-${appearance}`;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2,
      locale: "ja-JP", timezoneId: "Asia/Tokyo", serviceWorkers: "block" });
    const page = await context.newPage();
    page.on("pageerror", error => failures.push(`${currentCase}: ${error.stack ?? error.message}`));
    page.on("dialog", dialog => { failures.push(`${currentCase}: unexpected browser ${dialog.type()}`); void dialog.dismiss(); });
    await context.route("**/*", route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET" && request.resourceType() === "image" && url.href === reactionUrl) {
        fixtures.push(`${currentCase}: synthetic reaction image`);
        return route.fulfill({ status: 200, contentType: "image/svg+xml", path: resolve(import.meta.dir, "../public/demo/sticker-ok.svg") });
      }
      if (request.method() === "GET" && request.resourceType() === "stylesheet" && url.href === fontUrl) {
        fixtures.push(`${currentCase}: offline host font fallback`);
        return route.fulfill({ status: 200, contentType: "text/css", body: "/* Offline host font fallback. */" });
      }
      if (url.pathname.startsWith("/api/") || url.origin !== base.origin || !["GET", "HEAD"].includes(request.method())) {
        failures.push(`${currentCase}: blocked ${request.method()} ${url.href}`);
        return route.abort();
      }
      return route.continue();
    });
    await page.addInitScript(({ mode, appearance }) => {
      localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance }, version: 0 }));
      const target = window as any;
      target.__confirmationMediaAttempts = [];
      // biome-ignore lint/complexity/useArrowFunction: also replaces constructors so `new` records the forbidden attempt.
      const blocked = (name: string) => function () {
        target.__confirmationMediaAttempts.push(name);
        throw new Error(`Forbidden in confirmation test: ${name}`);
      };
      for (const name of ["getUserMedia", "getDisplayMedia", "enumerateDevices"])
        if (navigator.mediaDevices && name in navigator.mediaDevices)
          Object.defineProperty(navigator.mediaDevices, name, { value: blocked(name), configurable: true });
      for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "MediaRecorder"])
        if (name in target) target[name] = blocked(name);
    }, { mode, appearance });
    try {
      stage = "load accountless demo";
      await page.goto(`${base.origin}/pr-demo`, { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const iframe = page.locator(iframeSelector);
      const native = page.frameLocator(iframeSelector);
      const button = (name: string) => native.getByRole("button", { name, exact: true });
      const originalFrame = await iframe.elementHandle(); assert(originalFrame);
      const originalDocument = await iframe.evaluateHandle((node: HTMLIFrameElement) => node.contentDocument);
      page.on("framenavigated", frame => {
        if (frame === page.mainFrame() || frame.url().includes("/dist/ui-compose/"))
          failures.push(`${currentCase}: unexpected navigation ${frame.url()}`);
      });
      await expect(page.locator("html")).toHaveAttribute("data-ui-mode", mode);
      await expect(page.locator("html")).toHaveAttribute("data-appearance", appearance);
      await page.evaluate(async () => {
        const loaded = (path: string) => {
          const url = performance.getEntriesByType("resource").map(entry => entry.name)
            .findLast(url => new URL(url).pathname === path);
          if (!url) throw new Error(`Already-loaded Vite module required: ${path}`);
          return url;
        };
        const { useStore } = await import(loaded("/src/lib/store.ts"));
        const { requestControllerConfirm } = await import(loaded("/src/ui/controller-dialog.ts"));
        const safe = () => {
          const state = useStore.getState();
          if (location.pathname !== "/pr-demo" || !state.demoMode || state.accountId !== null || state.callRequest !== null)
            throw new Error("Accountless demo with no call request required");
        };
        safe();
        const audit = (window as any).__confirmation = { values: [] as boolean[], actions: [] as string[], callAttempts: 0,
          safe, begin: (message: string) => {
            safe(); audit.values = []; audit.actions = [];
            void requestControllerConfirm(message, { title: "ビデオ通話", acceptLabel: "発信", cancelFirst: true })
              .then((value: boolean) => audit.values.push(value));
          } };
        useStore.subscribe((state: { callRequest: unknown }) => { if (state.callRequest) audit.callAttempts++; });
        window.addEventListener("message", event => {
          if (event.origin !== location.origin || event.source !== document.querySelector<HTMLIFrameElement>('iframe[title="Vyline Compose UI"]')?.contentWindow) return;
          let data = event.data;
          try { if (typeof data === "string") data = JSON.parse(data); } catch { return; }
          if (["controller-dialog-accept", "controller-dialog-cancel", "call"].includes(data?.action)) audit.actions.push(data.action);
        });
      });
      const values = () => page.evaluate(() => (window as any).__confirmation.values as boolean[]);
      const retained = async () => {
        assert(await originalFrame.evaluate(node => node.isConnected), "Compose iframe remounted");
        assert(await iframe.evaluate((node: HTMLIFrameElement, original) => node.contentDocument === original, originalDocument), "Compose runtime reloaded");
        await expect(iframe).toHaveCount(1);
        assert.deepEqual(failures, []);
        for (const frame of page.frames()) assert.deepEqual(await frame.evaluate(() => (window as any).__confirmationMediaAttempts ?? []), []);
        assert.equal(await page.evaluate(() => { const audit = (window as any).__confirmation; audit.safe(); return audit.callAttempts; }), 0);
      };
      let callFixtureMounted = false;
      const noPresentedHostDialog = async () => {
        await expect(page.locator("dialog:modal")).toHaveCount(0);
        const candidates = await page.locator('dialog:visible, [role="dialog"]:visible, [role="alertdialog"]:visible').evaluateAll(nodes => nodes.map(node => {
          const owner = node.closest<HTMLElement>("[data-native-controller]");
          const style = owner && getComputedStyle(owner);
          const rect = node.getBoundingClientRect();
          const ownerRect = owner?.getBoundingClientRect();
          return {
            expectedFixture: node.matches('[data-call-fixture] [data-native-controller] [data-call-panel="expanded"][role="dialog"]'),
            hidden: owner?.getAttribute("aria-hidden") === "true" && owner.inert && style?.opacity === "0" && style.pointerEvents === "none",
            offscreen: !!ownerRect && ownerRect.width > 0 && ownerRect.height > 0 && ownerRect.right <= 0 && rect.right <= 0,
          };
        }));
        if (!callFixtureMounted) assert.deepEqual(candidates, []);
        else for (const candidate of candidates) assert.deepEqual(candidate, { expectedFixture: true, hidden: true, offscreen: true });
      };
      const open = async () => {
        await page.evaluate(message => (window as any).__confirmation.begin(message), text);
        await bounds(page, button("キャンセル"));
        await bounds(page, button("発信"));
        await bounds(page, native.getByText("ビデオ通話", { exact: true }));
        await expect(native.getByText(text, { exact: true })).toBeAttached();
        assert.match(await native.locator("body").ariaSnapshot(), /ビデオ通話/);
        await noPresentedHostDialog();
        await expect(native.locator("dialog:visible")).toHaveCount(0);
        assert.deepEqual(await values(), [], "Promise must stay pending without user input");
        await retained();
      };
      const settled = async (accepted: boolean) => {
        await expect.poll(values).toEqual([accepted]);
        await expect(button("発信")).toHaveCount(0); // Includes retained native exit frames.
        await page.waitForTimeout(200);
        assert.deepEqual(await values(), [accepted], "Exactly one promise observer notification");
        const actions = await page.evaluate(() => (window as any).__confirmation.actions as string[]);
        assert.deepEqual(actions, [accepted ? "controller-dialog-accept" : "controller-dialog-cancel"], "Exactly one native resolution action");
        await retained();
      };
      stage = "initial Enter cancels";
      await open();
      await page.screenshot({ path: resolve(output, `${currentCase}-confirmation.png`) });
      await writeFile(resolve(output, `${currentCase}-confirmation-ax.txt`), await native.locator("body").ariaSnapshot());
      await page.keyboard.press("Enter"); await settled(false);
      stage = "explicit pointer accepts exactly once";
      await open(); await click(page, button("発信")); await settled(true);
      stage = "Escape cancels";
      await open(); await page.keyboard.press("Escape"); await settled(false);
      // Even forward cycles return to cancel; odd reverse cycles end on accept.
      // Enter verifies real Compose focus, not merely the iframe's DOM focus.
      for (const [key, count, accepted] of [["Tab", 20, false], ["Shift+Tab", 19, true]] as const) {
        stage = `${key} focus trap`;
        await open();
        for (let index = 0; index < count; index++) {
          await page.keyboard.press(key);
          await page.waitForTimeout(40);
          await expect(iframe).toBeFocused();
          assert.deepEqual(await values(), []);
        }
        await page.keyboard.press("Enter"); await settled(accepted);
      }
      if (mode === "apple") {
        stage = "Apple outside click cancels";
        await open(); await page.mouse.click(24, 24); await settled(false);
      }
      stage = "synthetic video occlusion";
      // Existing presentation-only fixture has empty media refs and local handlers;
      // no useCall/getUserMedia/requestCall is mounted and no media is played.
      await page.evaluate(async () => {
        const load = (path: string) => import(path);
        const React = (await load("/node_modules/.vite/deps/react.js")).default;
        const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
        const { CallLayoutFixture } = await load("/scripts/call-layout-fixture.tsx");
        const node = document.createElement("div"); document.body.append(node);
        (window as any).__confirmationFixture = createRoot(node);
        (window as any).__confirmationFixture.render(React.createElement(CallLayoutFixture, { native: true, scenario: "video" }));
      });
      callFixtureMounted = true;
      const video = native.locator("[data-call-stage]");
      await expect(video).toBeVisible();
      const callLayout = viewport.width < 760 ? "expanded" : "docked";
      await expect(page.locator(`[data-call-fixture] [data-call-panel="${callLayout}"]`)).toBeAttached();
      const muted = () => page.locator("[data-call-fixture] output").evaluate(node => JSON.parse(node.textContent ?? "{}").muted as boolean);
      stage = `${callLayout} call mute focus origin`;
      await click(page, button("ミュート"));
      await expect.poll(muted).toBe(true);
      // Prove actual Compose keyboard focus before opening, not an AX onClick.
      await page.keyboard.press("Enter");
      await expect.poll(muted).toBe(false);
      stage = `${callLayout} call foreground focus restoration`;
      await open(); await expect(video).toBeHidden();
      await page.screenshot({ path: resolve(output, `${currentCase}-video-occluded.png`) });
      await page.keyboard.press("Escape"); await settled(false);
      await expect(video).toBeVisible();
      await page.keyboard.press("Enter");
      await expect.poll(muted, { message: "Enter after cancel must toggle the originating foreground mute control" }).toBe(true);
      await expect(button("ミュート解除")).toBeAttached();
      await page.screenshot({ path: resolve(output, `${currentCase}-video-restored.png`) });
      await page.evaluate(() => (window as any).__confirmationFixture.unmount());
      await retained();
      const wasm = await iframe.contentFrame().locator("body").evaluate(() =>
        performance.getEntriesByType("resource").map(entry => entry.name).filter(url => new URL(url).pathname.endsWith(".wasm")));
      results.push({ mode, appearance, wasm, status: "passed", initialEnterCancels: true, explicitAcceptOnce: true,
        escapeCancels: true, tabTrap: "20 forward / 19 reverse with Enter", outsideCancel: mode === "apple" ? true : "not required",
        titleAndAX: true, visibleHtmlDialog: false, videoOcclusionAndRestore: true,
        originatingCallMuteFocusRestored: callLayout, retainedIframeAndDocument: true });
      console.log(`${currentCase}: focused confirmation assertions passed`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${currentCase}-failure.png`) }).catch(() => undefined);
      const ax = await page.frameLocator(iframeSelector).locator("body").ariaSnapshot().catch(() => "Native semantics unavailable");
      const audit = await page.evaluate(() => ({
        values: (window as any).__confirmation?.values,
        actions: (window as any).__confirmation?.actions,
        navigation: performance.getEntriesByType("navigation").map(entry => entry.toJSON()),
      })).catch(() => null);
      await writeFile(resolve(output, `${currentCase}-failure.txt`), `${stage}\n${String(error)}\n${JSON.stringify(audit)}\n${ax}`);
      throw error;
    } finally { await context.close(); }
  }
  completed = true;
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ status: completed ? "passed" : "failed",
    base: base.origin, viewport, currentCase, stage, cases: results, failures, fixtures,
    scope: "Accountless controller-only confirmation; synthetic video presentation; no real calls/media/backend; screenshots require visual review; no pixel/backdrop golden" }, null, 2));
  await browser.close();
}
