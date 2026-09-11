import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-attachments-settings");
await mkdir(output, { recursive: true });
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Use a local demo server only");
// Chromium download-attribute requests bypass Playwright routing. Serve the PDF
// through Vite's local API proxy so this exercises an actual completed download.
const fixture = Bun.serve({
  hostname: "127.0.0.1", port: Number(process.env.VYLINE_TEST_BACKEND_PORT ?? 3001),
  fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.startsWith("/api/line/fixture-compose-files/media/"))
      return new Response("%PDF-1.4\nfixture-only\n%%EOF", { headers: {
        "content-type": "application/pdf", "content-disposition": 'attachment; filename="fixture.pdf"',
      } });
    return new Response("Fixture endpoint only", { status: 404 });
  },
});
const browser = await chromium.launch({ headless: true });
async function click(page: Page, locator: Locator) {
  await expect(locator).toBeAttached();
  await page.waitForTimeout(350);
  const rect = await locator.boundingBox();
  assert(rect);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}
try {
  for (const mode of ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true, serviceWorkers: "block" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      // The sole API response is a local PDF fixture; every other account/network operation is blocked.
      if (url.origin === new URL(base).origin && url.pathname.startsWith("/api/line/fixture-compose-files/media/"))
        return route.continue();
      if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });
    await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 })), mode);
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 90_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      for (const kind of ["file", "contact", "location", "preview"]) {
        await page.evaluate(async kind => {
          const { useStore } = await import("/src/lib/store.ts");
          const state = useStore.getState();
          if (!state.demoMode || ![null, "fixture-compose-files"].includes(state.accountId)) throw new Error("Demo-only check");
          const extra = kind === "file" ? { file: { name: "古典期末.pdf", size: 12058624 } }
            : kind === "contact" ? { contact: { mid: "fixture-contact", name: "連絡先カード", thumbnailUrl: `${location.origin}/demo/sticker-ok.svg` } }
            : kind === "location" ? { location: { title: "集合場所", address: "住所の表示", latitude: 35, longitude: 139 } }
            : { kind: "text", text: "リンクの本文", linkPreview: { url: "https://example.com/fixture", site: "Example", title: "リンクカード", description: "説明の表示", thumb: "E" } };
          useStore.setState({ accountId: "fixture-compose-files", messages: [{ id: `attachment-${kind}`, chatId: state.activeChatId, authorId: "me", kind, text: "", createdAt: Date.now(), status: "sent", read: false, messageState: "normal", ...extra }] });
        }, kind);
        const card = native.locator(".vy-kmp-inline-content");
        await expect(card).toBeVisible();
        await expect(card.locator("[data-native-controller]")).toHaveCount(0);
        assert(await card.getByRole("button", { name: "メッセージの操作", exact: true }).evaluate(node => node.classList.contains("sr-only")), "Keep the accessible action trigger visually hidden");
        if (kind === "file") {
          await expect(card.getByText("古典期末.pdf", { exact: true })).toBeVisible();
          await expect(card.getByText("11.5 MB", { exact: true })).toBeVisible();
          const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("link", { name: "ダウンロード", exact: true }).click()]);
          assert.equal(await download.failure(), null);
          assert((await readFile((await download.path())!, "utf8")).includes("fixture-only"));
        } else if (kind === "contact") await expect(card.getByText("連絡先カード", { exact: true })).toBeVisible();
        else if (kind === "location") await expect(card.getByRole("link", { name: "地図を開く", exact: true }).first()).toBeVisible();
        else await expect(card.getByText("リンクカード", { exact: true })).toBeVisible();
        await expect.poll(() => card.evaluate(node => {
          const bounds = node.getBoundingClientRect();
          const host = (node.getRootNode() as ShadowRoot).host.getBoundingClientRect();
          return Math.abs(bounds.height - host.height);
        })).toBeLessThan(2);
        await page.screenshot({ path: resolve(output, `${mode}-${kind}.png`) });
      }
      if (mode === "fluent") {
        await page.evaluate(async () => {
          const { useStore } = await import("/src/lib/store.ts");
          useStore.setState({ accountId: null });
        });
        // Open settings through its real Compose header command.
        await click(page, native.getByRole("button", { name: "設定", exact: true }).last());
        await expect(native.getByRole("button", { name: "設定ナビゲーション", exact: true })).toBeAttached();
        for (const width of [390, 1100]) {
          await page.setViewportSize({ width, height: 844 });
          const read = native.getByRole("tab", { name: "既読", exact: true });
          await click(page, read);
          await expect(native.getByRole("switch", { name: "既読を送る", exact: true })).toBeAttached();
          const collapsed = await read.boundingBox();
          assert(collapsed && collapsed.width <= 70, "Collapsed settings must remain an icon rail");
          await page.screenshot({ path: resolve(output, `fluent-settings-${width}-collapsed.png`) });
          await click(page, native.getByRole("button", { name: "設定ナビゲーション", exact: true }));
          await expect.poll(async () => (await read.boundingBox())?.width ?? 0).toBeGreaterThan(150);
          await page.screenshot({ path: resolve(output, `fluent-settings-${width}-expanded.png`) });
          await click(page, native.getByRole("tab", { name: "外観・UI", exact: true }));
          await expect.poll(async () => (await read.boundingBox())?.width ?? 1000).toBeLessThan(70);
          // Every category stays reachable when the rail scrolls on a small screen.
          await expect(native.getByRole("tab", { name: "ストレージ", exact: true })).toBeAttached();
        }
        await click(page, native.getByRole("button", { name: "閉じる", exact: true }).first());
        await expect(native.getByRole("button", { name: "設定ナビゲーション", exact: true })).toHaveCount(0);
      }
      assert.deepEqual(errors, []);
      console.log(`${mode}: file download and contact/location/link cards passed${mode === "fluent" ? "; compact and wide settings navigation passed" : ""}`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error({ mode, errors });
      console.error(await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot());
      throw error;
    } finally { await page.close(); }
  }
} finally { await browser.close(); fixture.stop(true); }
