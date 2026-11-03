import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ channel: "chrome", headless: true });
let checks = 0;
try {
  for (const mode of ["legacy", "nezu", "apple", "fluent", "miuix"]) {
    const native = ["apple", "fluent", "miuix"].includes(mode);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "127.0.0.1") return route.abort();
      if (decodeURIComponent(url.href).includes("privacy-avatar")) return route.fulfill({
        contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>',
      });
      return route.continue();
    });
    await context.addInitScript(() => {
      window.__privacyModel = {};
      window.__privacyMessages = {};
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async text => { window.__privacyClipboard = text; },
      } });
      const execCommand = document.execCommand.bind(document);
      document.execCommand = (command, ...args) => {
        if (command !== "copy") return execCommand(command, ...args);
        window.__privacyClipboard = document.activeElement?.value ?? getSelection()?.toString();
        return true;
      };
      addEventListener("message", event => {
        try {
          const value = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
          if (value?.channel !== "vyline-ui" || !["snapshot", "patch"].includes(value.type)) return;
          Object.assign(window.__privacyModel, value);
          for (const message of value.messages ?? value.messageDelta?.updates ?? []) window.__privacyMessages[message.id] = message;
        } catch { /* Ignore non-model product messages. */ }
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:5187/pr-demo");
    await expect(page.getByText("DEMO MODE ON · 仮データのみ · 実アカウント接続なし")).toBeVisible();
    await page.evaluate(async mode => {
      const moduleUrl = path => performance.getEntriesByType("resource").find(resource => new URL(resource.name).pathname === path)?.name ?? path;
      const { useStore } = await import(moduleUrl("/src/lib/store.ts"));
      const { useDesignSystemStore } = await import(moduleUrl("/src/ui/design-system-store.ts"));
      const { emitAppEvent } = await import(moduleUrl("/src/lib/appEvents.ts"));
      window.__privacyStore = useStore;
      window.__privacyEvent = emitAppEvent;
      const chatId = `c${"1".repeat(32)}`;
      const authorId = `u${"1".repeat(32)}`;
      const text = "前 https://message.private.example/path。 @Private Person";
      const message = { id: "200", chatId, authorId, kind: "text", text, createdAt: Date.now(), status: "sent", read: false, messageState: "normal",
        mentions: [{ S: text.indexOf("@Private"), E: text.length, mid: authorId }] };
      useStore.setState({ screen: "chat", activeChatId: chatId, chatPaneIds: [chatId], chatPaneSizes: [100], focusedChatPane: 0,
        chats: [{ id: chatId, type: "group", name: "Private Header", avatar: "H", avatarUrl: "/privacy-avatar-header.svg", color: "blue", unread: 0,
          status: "https://status.private.example/path", members: [{ id: authorId, name: "Private Person", avatar: "P", avatarUrl: "/privacy-avatar-author.svg", color: "blue" }] }],
        messages: [message, { ...message, id: "201", text: "返信", mentions: undefined, replyToId: "200", createdAt: message.createdAt + 1 }],
        replyToId: "200", announcements: { [chatId]: [{ announcementSeq: "1", text: "固定 https://announcement.private.example/path", link: "line://nv/chat?messageId=200" }] },
        settings: { ...useStore.getState().settings, streamerMode: true },
      });
      useDesignSystemStore.getState().setMode(mode);
      emitAppEvent("chat:ui-command", { chatId, action: "search-query", value: "前" });
    }, mode);
    let frame;
    if (native) {
      await expect(page.locator("iframe")).toHaveCount(1);
      frame = page.frames().find(frame => frame !== page.mainFrame());
      await frame.waitForFunction(() => !!window.__privacyModel.chat && !!window.__privacyMessages["200"]);
    }
    for (let flags = 0; flags < 8; flags++) {
      const names = Boolean(flags & 1);
      const avatars = Boolean(flags & 2);
      const urls = Boolean(flags & 4);
      await page.evaluate(({ names, avatars, urls }) => {
        const state = window.__privacyStore.getState();
        window.__privacyStore.setState({ settings: { ...state.settings, streamerMaskNames: names, streamerMaskAvatars: avatars, streamerMaskUrls: urls } });
        window.__privacyEvent("chat:ui-command", { chatId: state.activeChatId, action: "search-query", value: "前" });
      }, { names, avatars, urls });
      if (native) {
        await frame.waitForFunction(({ names, avatars, urls }) => {
          const model = window.__privacyModel;
          const row = window.__privacyMessages["200"];
          const search = model.chatUi?.search;
          return model.chat.title === (names ? "グループ" : "Private Header") &&
            Boolean(model.chat.avatarUrl) === !avatars && row.authorName === (names ? "メンバー" : "Private Person") &&
            Boolean(row.avatarUrl) === !avatars && model.chat.status.includes("status.private.example") === !urls &&
            row.text.includes("message.private.example") === !urls &&
            model.announcements?.[0]?.text.includes("announcement.private.example") === !urls &&
            model.composer?.replyText?.includes("message.private.example") === !urls &&
            search?.results?.length === 1 && search.results[0].text.includes("message.private.example") === !urls;
        }, { names, avatars, urls });
      } else {
        const title = page.locator(".vy-chat-header-title");
        await expect(title).toHaveText(names ? "グループ" : "Private Header");
        const header = page.locator("header").filter({ has: title });
        await expect(header.locator('img[src*="privacy-avatar-header"]')).toHaveCount(avatars ? 0 : 1);
        await expect.poll(async () => (await header.innerText()).includes("status.private.example")).toBe(!urls);
        const first = page.locator('[data-vy-message="true"]').first();
        await expect.poll(async () => (await first.innerText()).includes("message.private.example")).toBe(!urls);
        await expect(page.locator('[data-vy-message="true"] img[src*="privacy-avatar-author"]')).toHaveCount(avatars ? 0 : 1);
        await expect.poll(async () => (await first.innerText()).includes("Private Person")).toBe(!names);
        await expect.poll(() => page.locator('button[title*="announcement.private.example"]').count()).toBe(urls ? 0 : 1);
        const reply = page.locator(".vy-composer");
        await expect.poll(async () => (await reply.innerText()).includes("message.private.example")).toBe(!urls);
        await expect.poll(async () => (await reply.innerText()).includes("Private Person")).toBe(!names);
      }
      checks++;
    }
    // Copy uses the same display policy; the browser clipboard is replaced with a fixture recorder.
    if (native) {
      await frame.evaluate(() => window.parent.postMessage(JSON.stringify({ channel: "vyline-ui", version: 1, type: "action", action: "message-menu",
        id: "200", chatId: window.__privacyModel.chat.id, epoch: window.__privacyModel.epoch, x: 100, y: 100 }), location.origin));
      await frame.waitForFunction(() => window.__privacyModel.hostMenu?.items?.some(item => item.label === "コピー"));
      await frame.evaluate(() => {
        const model = window.__privacyModel;
        const item = model.hostMenu.items.find(item => item.label === "コピー");
        window.parent.postMessage(JSON.stringify({ channel: "vyline-ui", version: 1, type: "action", action: "host-menu", id: item.id, epoch: model.epoch }), location.origin);
      });
    } else {
      await page.locator('[data-vy-message="true"]').first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "コピー", exact: true }).click();
    }
    await expect.poll(() => page.evaluate(() => window.__privacyClipboard)).toBe("前 [URL]。 @メンバー");
    expect(await page.evaluate(() => window.__privacyStore.getState().messages[0].text)).toBe("前 https://message.private.example/path。 @Private Person");
    expect(errors).toEqual([]);
    checks++;
    await context.close();
  }
  console.log(`${checks} privacy checks passed across 5 modes; 0 page errors; no external requests or real clipboard writes`);
} finally { await browser.close(); }
