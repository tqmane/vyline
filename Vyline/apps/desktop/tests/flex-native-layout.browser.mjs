import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ channel: "chrome", headless: true });
let checks = 0;
try {
  for (const mode of ["legacy", "nezu", "apple", "fluent", "miuix"]) {
    const context = await browser.newContext();
    await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("http://127.0.0.1:5187/pr-demo");
      await expect(page.getByText("DEMO MODE ON · 仮データのみ · 実アカウント接続なし")).toBeVisible();
      await page.evaluate(async mode => {
        const moduleUrl = path => performance.getEntriesByType("resource").find(resource => new URL(resource.name).pathname === path)?.name ?? path;
        const { useStore } = await import(moduleUrl("/src/lib/store.ts"));
        const { mapMessage } = await import(moduleUrl("/src/lib/mappers.ts"));
        const { useDesignSystemStore } = await import(moduleUrl("/src/ui/design-system-store.ts"));
        const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="330"><rect width="300" height="330" fill="#c99c12"/><text x="20" y="80" fill="white" font-size="24">Image-only card</text></svg>')}`;
        const bubble = { type: "bubble", hero: { type: "image", url: image, size: "full", aspectRatio: "10:11", aspectMode: "cover" } };
        const chatId = "fixture-native-flex";
        const raw = { id: "900", from: "fixture-sender", to: chatId, isMyMessage: false, createdTime: Date.now(), contentType: "FLEX", text: null,
          contentMetadata: { FLEX_JSON: JSON.stringify({ type: "carousel", contents: [bubble, bubble] }), ALT_TEXT: "Image-only carousel fixture" } };
        useStore.setState({ screen: "chat", activeChatId: chatId, chatPaneIds: [chatId], chatPaneSizes: [100], focusedChatPane: 0,
          chats: [{ id: chatId, type: "friend", name: "Flex fixture", avatar: "F", color: "blue", unread: 0, status: "" }],
          messages: [mapMessage(raw, chatId, "")], replyToId: null, announcements: {}, settings: { ...useStore.getState().settings, streamerMode: false } });
        useDesignSystemStore.getState().setMode(mode);
      }, mode);
      const native = ["apple", "fluent", "miuix"].includes(mode);
      let surface = page;
      if (native) {
        await expect(page.locator("iframe")).toHaveCount(1);
        surface = page.frameLocator("iframe");
      }
      const cards = surface.locator(".vfx .T1");
      await expect(cards).toHaveCount(2, { timeout: 30_000 });
      for (let index = 0; index < 2; index++) {
        await expect.poll(() => cards.nth(index).evaluate(element => element.getBoundingClientRect().width), { timeout: 10_000 }).toBeGreaterThan(200);
        await expect.poll(() => cards.nth(index).evaluate(element => element.getBoundingClientRect().height), { timeout: 10_000 }).toBeGreaterThan(200);
      }
      const carousel = surface.locator(".vfx.flex");
      await expect.poll(() => carousel.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
      await carousel.evaluate(element => { element.scrollLeft = element.scrollWidth; });
      await expect.poll(() => carousel.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      checks++;
    }
    expect(errors).toEqual([]);
    await context.close();
  }
  console.log(`${checks} actual-app Flex layout checks passed across all 5 modes; mapper and native hosted slots included; no external requests`);
} finally { await browser.close(); }
