import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function runMobileInputProbes({ page, frame, state, artifacts, expect, clickNative }) {
  const output = join(artifacts, "mobile", state.mode);
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type,
    touchPoints: type === "touchEnd" ? [] : [{ x, y, radiusX: 2, radiusY: 2, force: .5, id: 1 }] });
  const drag = async (x, from, to) => {
    await touch("touchStart", x, from);
    for (let step = 1; step <= 24; step++) {
      await touch("touchMove", x, from + (to - from) * step / 24);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd");
    await page.waitForTimeout(350);
  };
  const patch = (value) => page.evaluate((value) => window.sendPatch(value), value);
  const button = (name) => frame.getByRole("button", { name, exact: true });
  const editor = frame.getByRole("textbox", { name: "メッセージを入力", exact: true });
  const deepFocus = () => frame.evaluate(() => {
    let node = document.activeElement;
    while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
    return { tag: node?.tagName, editable: node?.isContentEditable === true };
  });
  const messages = Array.from({ length: 90 }, (_, index) => ({ ...state.messages[index], id: `mobile-${index}`,
    authorId: index % 2 ? "friend" : "me", text: `履歴 ${index}`, kind: "text", hostContent: false, groupStart: true, groupEnd: true }));
  const fixture = { ...state, dark: true, reducedMotion: false, hostMenu: null, readersPanel: null, profileOpen: false,
    chat: { ...state.chat, id: "mobile-chat", title: "モバイル検証", isGroup: true, canCall: true, canVideoCall: true,
      members: Array.from({ length: 35 }, (_, index) => ({ id: `member-${index}`, name: `メンバー ${index}`, avatar: "M", color: "#7595B6" })) },
    messages, history: { hasMore: false, loading: false }, composer: { ...state.composer, text: "", pending: [] },
    announcements: Array.from({ length: 5 }, (_, index) => ({ id: String(index), text: `アナウンス ${index}` })),
    chatUi: { announcementExpanded: false }, scrollLatest: 0 };
  const snapshot = (value) => page.evaluate((value) => { window.actions = []; window.sendSnapshot(value); }, value);
  const visibleMessages = () => frame.getByRole("button", { name: /^履歴 \d+$/ }).evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect(); return { text: node.textContent, y: rect.y, bottom: rect.bottom };
  }).filter((entry) => entry.y > 240 && entry.bottom < 630));
  const measurement = () => frame.evaluate(({ epoch, chatId }) =>
    window.__vylineTimelines?.[`${epoch}:${chatId}`] ?? null,
    { epoch: fixture.epoch, chatId: fixture.chat.id });
  const atBottom = async (id) => {
    const sample = await measurement();
    return !!sample && sample.epoch === fixture.epoch && sample.chatId === fixture.chat.id &&
      sample.paneId === fixture.chat.id && sample.expectedLastKey === id && sample.lastKey === id &&
      sample.messageCount > 0 && sample.lastIndex === sample.totalItemsCount - 1 &&
      !sample.isScrollInProgress && !sample.canScrollForward &&
      sample.lastOffset + sample.lastSize + sample.afterContentPadding <= sample.viewportEndOffset + 1;
  };
  const resetTimeline = async (overrides = {}) => {
    await snapshot({ ...fixture, chat: null, messages: [] });
    await expect.poll(measurement).toBe(null);
    await snapshot({ ...fixture, ...overrides });
  };
  const bottomCases = [];
  const bottomCase = async (name, run) => {
    try {
      await run();
      bottomCases.push({ name, status: "passed", sample: await measurement() });
    } catch (error) {
      bottomCases.push({ name, status: "failed", error: String(error), sample: await measurement() });
    }
    await page.screenshot({ path: join(output, `${name}.png`) });
    await writeFile(join(output, "true-bottom.json"), JSON.stringify(bottomCases, null, 2));
  };
  try {
    await bottomCase("tall-final-row", async () => {
      await resetTimeline();
      await expect.poll(() => atBottom(messages.at(-1).id)).toBe(true);
      const tall = { ...messages.at(-1), id: "mobile-tall-final", authorId: "friend",
        text: Array.from({ length: 65 }, (_, index) => `長い最終行 ${index + 1}`).join("\n") };
      await patch({ messages: [...messages, tall], scrollLatest: 1 });
      await expect.poll(async () => {
        const sample = await measurement();
        return sample?.lastKey === tall.id && sample.lastSize > sample.viewportEndOffset - sample.viewportStartOffset;
      }).toBe(true);
      await expect.poll(() => atBottom(tall.id), { message: "Tall final row footer and trailing padding must reach the actual end" }).toBe(true);
    });
    await bottomCase("delayed-image-growth", async () => {
      await resetTimeline();
      await expect.poll(() => atBottom(messages.at(-1).id)).toBe(true);
      const url = new URL(`/delayed-bottom-${state.mode}-${Date.now()}.svg`, page.url()).href;
      let release;
      const ready = new Promise(resolve => { release = resolve; });
      let requested = false;
      const handler = async route => {
        requested = true;
        await ready;
        await route.fulfill({ contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="1200"><rect width="260" height="1200" fill="#7595b6"/><text x="16" y="1180" fill="white">image footer</text></svg>' });
      };
      await page.route(url, handler);
      try {
        const image = { ...messages.at(-1), id: "mobile-delayed-image", authorId: "friend", kind: "image",
          text: "遅延画像の末尾", mediaUrl: url, fileName: "synthetic-portrait.svg" };
        await patch({ messages: [...messages, image], scrollLatest: 1 });
        await expect.poll(() => requested).toBe(true);
        await expect.poll(() => atBottom(image.id)).toBe(true);
        const loading = await measurement();
        release();
        await expect.poll(async () => {
          const sample = await measurement();
          return sample?.lastKey === image.id && sample.lastSize > loading.lastSize + 100;
        }).toBe(true);
        await expect.poll(() => atBottom(image.id), { message: "Decoded image growth must preserve actual end ownership without another scroll intent" }).toBe(true);
      } finally {
        release();
        await page.unroute(url, handler);
      }
    });
    await bottomCase("empty-load-retains-bottom-intent", async () => {
      await resetTimeline({ messages: [], history: { hasMore: false, loading: true }, scrollLatest: 2 });
      await expect.poll(async () => (await measurement())?.messageCount).toBe(0);
      await patch({ messages, history: fixture.history });
      await expect.poll(() => atBottom(messages.at(-1).id)).toBe(true);
    });
    await bottomCase("user-history-defeats-reconcile", async () => {
      await resetTimeline();
      await expect.poll(() => atBottom(messages.at(-1).id)).toBe(true);
      await drag(190, 350, 650);
      const anchor = (await visibleMessages())[0];
      assert(anchor, "History must be visible before reconcile");
      const own = { ...messages.at(-1), id: "mobile-own-reconcile", authorId: "me", text: "受理済み送信の遅い置換" };
      await patch({ messages: [...messages, own] });
      await expect.poll(async () => (await measurement())?.expectedLastKey).toBe(own.id);
      await expect.poll(async () => Math.abs((await button(anchor.text).boundingBox())?.y - anchor.y)).toBeLessThan(2);
      assert.equal(await atBottom(own.id), false, "Author me alone must not seize the user's viewport");
      await patch({ scrollLatest: 3 });
      await expect.poll(() => atBottom(own.id)).toBe(true);
    });
    await bottomCase("near-end-disclosure-retains-history", async () => {
      await resetTimeline();
      await expect.poll(() => atBottom(messages.at(-1).id)).toBe(true);
      await page.mouse.move(190, 600);
      await page.mouse.wheel(0, -40);
      await expect.poll(async () => {
        const sample = await measurement();
        return sample?.ownership === "history" && !sample.isScrollInProgress && sample.canScrollForward;
      }).toBe(true);
      const before = await measurement();
      const distance = before.lastOffset + before.lastSize + before.afterContentPadding - before.viewportEndOffset;
      assert(Math.abs(distance / before.density - 40) <= 3, `Expected 40 CSS px before end, got ${distance / before.density}`);
      const last = button(messages.at(-1).text);
      const anchor = await last.boundingBox();
      assert(anchor);
      for (const expanded of [true, false]) {
        const previous = await measurement();
        await patch({ chatUi: { announcementExpanded: expanded } });
        await expect(button(expanded ? "アナウンスを折りたたむ" : "アナウンスを展開")).toBeAttached();
        await expect.poll(async () => {
          const sample = await measurement();
          return !!sample && (expanded ? sample.viewportStartOffset < previous.viewportStartOffset :
            sample.viewportStartOffset === before.viewportStartOffset);
        }, { message: "Disclosure must be measured before accepting its anchor" }).toBe(true);
        await expect.poll(async () => {
          const sample = await measurement();
          if (!sample || sample.lastKey !== before.lastKey) return Infinity;
          return Math.abs((sample.lastOffset - sample.viewportStartOffset) -
            (before.lastOffset - before.viewportStartOffset)) / sample.density;
        }).toBeLessThan(3);
        await expect.poll(async () => {
          const box = await last.boundingBox();
          return box && box.height > 0 ? Math.abs(box.y - anchor.y) : Infinity;
        }).toBeLessThan(3);
        assert.equal((await measurement())?.ownership, "history");
        assert.equal(await atBottom(messages.at(-1).id), false);
      }
      await page.mouse.wheel(0, 80);
      await expect.poll(() => atBottom(messages.at(-1).id)).toBe(true);
      await expect.poll(async () => (await measurement())?.ownership).toBe("bottom");
      const next = { ...messages.at(-1), id: "mobile-after-user-end", authorId: "friend", text: "末尾へ戻った後の新着" };
      await patch({ messages: [...messages, next] });
      await expect.poll(() => atBottom(next.id)).toBe(true);
    });
    assert(bottomCases.every(result => result.status === "passed"), JSON.stringify(bottomCases, null, 2));
    if (process.env.VYLINE_TRUE_BOTTOM_ONLY === "1") return;
    await resetTimeline();
    await expect.poll(() => atBottom(messages.at(-1).id)).toBe(true);
    assert.equal(await frame.locator("canvas").first().evaluate((node) => getComputedStyle(node).touchAction), "pinch-zoom");
    await clickNative(editor);
    await page.keyboard.insertText("入力を保持");
    const focusBefore = await deepFocus();
    assert(focusBefore.tag === "TEXTAREA" || focusBefore.tag === "INPUT" || focusBefore.editable);
    await drag(190, 350, 650);
    assert.deepEqual(await deepFocus(), focusBefore, "History drag must retain the active IME input");
    await expect(editor).toHaveText("入力を保持");
    const anchor = (await visibleMessages())[0]; assert(anchor, "Older history must be visible after touch drag");
    const incoming = { ...messages.at(-1), id: "mobile-incoming", text: "新着の履歴", authorId: "friend" };
    await patch({ messages: [...messages, incoming] });
    await expect.poll(async () => Math.abs((await button(anchor.text).boundingBox())?.y - anchor.y)).toBeLessThan(2);
    await expect(button("最新のメッセージへ")).toBeAttached();
    await patch({ chatUi: { announcementExpanded: true } });
    await expect.poll(async () => Math.abs((await button(anchor.text).boundingBox())?.y - anchor.y)).toBeLessThan(2);
    await patch({ chatUi: { announcementExpanded: false } });
    await expect.poll(async () => Math.abs((await button(anchor.text).boundingBox())?.y - anchor.y)).toBeLessThan(2);
    await page.screenshot({ path: join(output, "history-anchor.png") });
    await clickNative(button("最新のメッセージへ"));
    await expect.poll(() => atBottom(incoming.id)).toBe(true);
    const next = { ...incoming, id: "mobile-next", text: "末尾付近の新着" };
    await patch({ messages: [...messages, incoming, next] });
    await expect.poll(() => atBottom(next.id)).toBe(true);
    await page.setViewportSize({ width: 390, height: 520 });
    await expect.poll(() => atBottom(next.id)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await patch({ composer: { ...fixture.composer, text: "複数行\n入力\n送信" } });
    await drag(190, 340, 570);
    await clickNative(button("送信"));
    await page.waitForFunction(() => window.actions.some((action) => action.action === "send"));
    const sent = { ...next, authorId: "me", id: "mobile-sent", text: "自分の送信" };
    // Renderer fixture models the accepted-send intent; host/store integration is tested separately.
    await patch({ messages: [...messages, incoming, next, sent], composer: fixture.composer, scrollLatest: 1 });
    await expect.poll(() => atBottom(sent.id)).toBe(true);
    const call = { ...sent, id: "mobile-call", kind: "call", text: "グループ通話が終了しました" };
    await patch({ messages: [call] });
    await expect.poll(async () => {
      const box = await frame.getByText(call.text, { exact: true }).last().boundingBox();
      return box ? Math.abs(box.x + box.width / 2 - 195) : 1000;
    }).toBeLessThan(20);
    await clickNative(button("添付とその他の操作"));
    await expect(button("ファイル")).toBeAttached();
    await page.screenshot({ path: join(output, "attachment-menu.png") });
    await clickNative(button("ファイル"));
    await page.waitForFunction(() => window.actions.some((action) => action.action === "attach"));
    await expect(button("ファイル")).toHaveCount(0);
    const readers = Array.from({ length: 32 }, (_, index) => ({ id: `reader-${index}`, name: `既読メンバー ${index}`, readAt: 1788800000000 }));
    await patch({ messages: [{ ...sent, readers, readCount: 32 }], readersPanel: { messageId: sent.id, loading: false } });
    const reader = frame.getByRole("button", { name: /^既読メンバー 0、/ });
    await expect(reader).toBeAttached();
    const before = await reader.boundingBox(); assert(before);
    await drag(190, 610, 300);
    const after = await reader.boundingBox();
    assert(!after || after.y < before.y - 50, "Reader list must consume touch scroll");
    await page.screenshot({ path: join(output, "readers-scrolled.png") });
    await patch({ readersPanel: null });
    await expect(reader).toHaveCount(0);
    if (state.mode === "apple") {
      await clickNative(button("ビデオ通話"));
      await page.waitForFunction(() => window.actions.some((action) => action.action === "call" && action.value === "video"));
      const tabs = [{ id: "all", label: "全体" }, { id: "friend", label: "友だち" }, { id: "group", label: "グループ" }, { id: "official", label: "公式" }, { id: "hidden", label: "非表示" }];
      await snapshot({ ...fixture, chat: null, messages: [], rows: [], tabs, tab: "hidden" });
      await clickNative(button("トークのフィルタ"));
      await expect(frame.getByRole("tab")).toHaveCount(5);
      const labels = await Promise.all(tabs.map((tab) => frame.getByText(tab.label, { exact: true }).boundingBox()));
      assert(labels.every(Boolean));
      const last = labels[4]; const first = labels[0]; const y = last.y + last.height / 2;
      await touch("touchStart", last.x + last.width / 2, y); await page.waitForTimeout(650);
      for (let step = 1; step <= 32; step++) {
        const x = last.x + last.width / 2 + (first.x + first.width / 2 - last.x - last.width / 2) * step / 32;
        await touch("touchMove", x, y); await page.waitForTimeout(16);
        const current = await Promise.all(tabs.map((tab) => frame.getByText(tab.label, { exact: true }).boundingBox()));
        current.forEach((bounds, index) => { assert(bounds); assert(Math.abs(bounds.x - labels[index].x) < .5 && Math.abs(bounds.y - labels[index].y) < .5 && Math.abs(bounds.width - labels[index].width) < .5, "Tab glyph geometry must stay fixed through drag"); });
        if (step % 8 === 0) await page.screenshot({ path: join(output, `tabs-drag-${step}.png`) });
      }
      assert.equal(await page.evaluate(() => window.actions.filter((action) => action.action === "tab").length), 0);
      await touch("touchEnd");
      await page.waitForFunction(() => window.actions.some((action) => action.action === "tab" && action.id === "all"));
    }
    await writeFile(join(output, "result.json"), JSON.stringify({ mode: state.mode, touch: true, focusRetained: true, anchorStable: true, sendAndIncoming: true, viewportResize: true, readersScroll: true, nativeMenus: true }, null, 2));
    console.log(`${state.mode}: mobile touch, IME focus, resize, anchor, send/incoming, call and menus PASS`);
  } catch (error) {
    await writeFile(join(output, "failure-timeline.json"), JSON.stringify(await measurement(), null, 2));
    await page.screenshot({ path: join(output, "failure.png") });
    await writeFile(join(output, "failure-semantics.txt"), await frame.locator("body").ariaSnapshot());
    await writeFile(join(output, "failure-roles.json"), JSON.stringify(await frame.locator("[role]").evaluateAll((nodes) => nodes.map((node) => ({ role: node.getAttribute("role"), text: node.textContent, html: node.outerHTML.slice(0, 600) }))), null, 2));
    throw error;
  } finally {
    await cdp.detach();
    await page.setViewportSize({ width: 390, height: 844 });
    await snapshot(state);
  }
}
