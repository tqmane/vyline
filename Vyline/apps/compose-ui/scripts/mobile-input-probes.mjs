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
  const atBottom = async (text) => {
    const message = await button(text).boundingBox(); const field = await editor.boundingBox();
    return !!message && !!field && message.y + message.height <= field.y && message.y > 0;
  };
  try {
    await snapshot(fixture);
    await expect.poll(() => atBottom("履歴 89")).toBe(true);
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
    await expect.poll(() => atBottom(incoming.text)).toBe(true);
    const next = { ...incoming, id: "mobile-next", text: "末尾付近の新着" };
    await patch({ messages: [...messages, incoming, next] });
    await expect.poll(() => atBottom(next.text)).toBe(true);
    await page.setViewportSize({ width: 390, height: 520 });
    await expect.poll(() => atBottom(next.text)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await patch({ composer: { ...fixture.composer, text: "複数行\n入力\n送信" } });
    await drag(190, 340, 570);
    await clickNative(button("送信"));
    await page.waitForFunction(() => window.actions.some((action) => action.action === "send"));
    const sent = { ...next, authorId: "me", id: "mobile-sent", text: "自分の送信" };
    await patch({ messages: [...messages, incoming, next, sent], composer: fixture.composer });
    await expect.poll(() => atBottom(sent.text)).toBe(true);
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
