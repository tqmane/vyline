import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

// Offline regression: exercise the real React -> Compose -> shadow portal path.
const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-rich-content");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });
    await page.addInitScript((mode) => {
      localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }));
      const opened: string[] = [];
      Object.assign(window, { __richOpened: opened });
      window.open = (url) => { opened.push(String(url)); return null; };
    }, mode);
    await page.goto(`${base}/pr-demo`);
    await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 90_000 });
    const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
    for (const kind of ["rich", "flex", "album"]) {
      await page.evaluate(async (kind) => {
        const { useStore } = await import("/src/lib/store.ts");
        const state = useStore.getState();
        if (!state.demoMode || state.accountId !== null) throw new Error("Demo-only check");
        const message = {
          id: `fixture-${kind}`, chatId: state.activeChatId, authorId: "me", kind,
          text: "", altText: "公式ストアのカード", createdAt: Date.now(),
          status: "sent", messageState: "normal", read: false,
        };
        const uri = "https://store.line.me/fixture";
        const image = `${location.origin}/demo/sticker-ok.svg`;
        const card = kind === "rich" ? {
          richImageUrl: image,
          richMarkup: {
            canvas: { width: 1040, height: 520, initialScene: "scene1" },
            scenes: { scene1: { listeners: [
              { params: [0, 0, 520, 520], action: "left" },
              { params: [520, 0, 520, 520], action: "right" },
            ] } },
            actions: {
              left: { text: "左の商品", params: { linkUri: `${uri}/left` } },
              right: { text: "右の商品", params: { linkUri: `${uri}/right` } },
            },
          },
        } : kind === "flex" ? {
          flexJson: { type: "carousel", contents: ["商品A", "商品B"].map((text) => ({
            type: "bubble", hero: { type: "image", url: image, size: "full", aspectRatio: "2:1" },
            body: { type: "box", layout: "vertical", contents: [{ type: "text", text }] },
            footer: { type: "box", layout: "vertical", contents: [
              { type: "button", action: { type: "uri", label: `${text}を開く`, uri: `${uri}/${text}` } },
            ] },
          })) },
        } : { kind: "text", postNotification: { kind: "album", albumId: "fixture-album", title: "旅行アルバム", mediaCount: 3 } };
        useStore.setState({ messages: [{ ...message, ...card }] });
      }, kind);
      const card = native.locator(".vy-kmp-inline-content");
      await expect(card).toBeVisible();
      await expect(card.locator("[data-native-controller]")).toHaveCount(0);
      if (kind === "rich") {
        const image = card.getByRole("img", { name: "公式ストアのカード" });
        await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
        const left = card.getByRole("button", { name: "左の商品" });
        const right = card.getByRole("button", { name: "右の商品" });
        const a = await left.boundingBox();
        const b = await right.boundingBox();
        assert(a && b && a.width > 100 && Math.abs(a.x + a.width - b.x) < 2);
        assert(Math.abs(a.height - a.width) < 2, "Image-map aspect ratio must survive");
        await left.click(); await right.click();
        await expect.poll(() => page.evaluate(() => (window as any).__richOpened)).toEqual([
          "https://store.line.me/fixture/left", "https://store.line.me/fixture/right",
        ]);
      } else if (kind === "flex") {
        await expect(card.getByText("商品A", { exact: true })).toBeVisible();
        await expect(card.getByText("商品B", { exact: true })).toBeAttached();
        await card.getByText("商品Aを開く", { exact: true }).click();
        await expect.poll(() => page.evaluate(() => (window as any).__richOpened.at(-1))).toBe("https://store.line.me/fixture/商品A");
      } else {
        await expect(card.getByText("旅行アルバム", { exact: true })).toBeVisible();
        await expect(card.getByText("3件のメディア", { exact: true })).toBeVisible();
      }
      await expect.poll(() => card.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const host = (node.getRootNode() as ShadowRoot).host.getBoundingClientRect();
        return Math.abs(bounds.height - host.height);
      })).toBeLessThan(2);
      await page.screenshot({ path: resolve(output, `${mode}-${kind}.png`) });
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${mode}: Rich images/hotspots, Flex carousel/actions, album and measured heights passed`);
  }
} finally {
  await browser.close();
}
