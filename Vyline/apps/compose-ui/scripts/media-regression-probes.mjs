import assert from "node:assert/strict";
import { join } from "node:path";

/** Offline snapshot/action harness only. No backend, account or LINE operations. */
export async function runMediaRegressionProbes({ page, frame, state, artifacts, expect, clickNative }) {
  const failures = [];
  const mode = state.mode;
  const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="red"/></svg>')}`;
  const messages = Array.from({ length: 30 }, (_, i) => ({
    id: `m${i}`, authorId: "friend", authorName: "Friend", kind: "text",
    text: `Message ${i}`, createdAt: 1788706800000 + i * 60000,
    time: "12:34", status: "sent", messageState: "normal", groupStart: true, groupEnd: true,
  }));
  messages.push({ id: "animated", authorId: "friend", authorName: "Friend", kind: "sticker",
    text: "Audit animated sticker", mediaUrl: image, stickerAnimated: true,
    time: "12:34", status: "sent", messageState: "normal" });
  const fixture = {
    mode, epoch: (state.epoch ?? 1) + 100, dark: false, view: "chat",
    tabs: [{ id: "all", label: "All" }], rows: [],
    chat: { id: "audit", title: "Offline audit", avatar: "A", color: "#7C98B8" },
    messages, composer: { available: true, enterToSend: true },
  };
  const send = async value => {
    await page.evaluate(value => { window.actions = []; window.sendSnapshot(value); }, value);
  };
  const sticker = frame.locator('button[aria-label="Audit animated sticker"]');
  const readySticker = async () => {
    await expect(sticker).toBeVisible();
    await page.waitForTimeout(600);
    const box = await sticker.boundingBox();
    assert(box && box.width > 0 && box.height > 0);
    return box;
  };
  const measurement = () => frame.evaluate(() => Object.values(window.__vylineTimelines ?? {})[0]);
  const check = async (name, run) => {
    try { await run(); console.log(`${mode}: ${name} PASS`); }
    catch (error) {
      failures.push(new Error(`${mode}: ${name}: ${error.message}`));
      await page.screenshot({ path: join(artifacts, `${mode}-${name}-failure.png`) });
      console.error(failures.at(-1).message);
    }
  };
  try {
    // Commit an empty conversation before reusing the same synthetic chat/epoch
    // in another theme; intermediate postMessages may be coalesced in one frame.
    await send({ ...fixture, epoch: fixture.epoch - 1, chat: null, messages: [],
      hostMenu: null, nativePanel: null, controllerCall: null, controllerDialog: null });
    await expect(sticker).toHaveCount(0);
    await expect(frame.getByRole("button", { name: "閉じる", exact: true })).toHaveCount(0);
    await check("animated-sticker-touch-scroll", async () => {
      await send(fixture);
      const box = await readySticker();
      const before = await measurement();
      assert(before, "selftest=1 must publish timeline geometry");
      const cdp = await page.context().newCDPSession(page);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 3;
      try {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let i = 1; i <= 6; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + i * 12 }] });
          await page.waitForTimeout(35);
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } finally { await cdp.detach(); }
      await expect.poll(async () => {
        const after = await measurement();
        return after.lastOffset !== before.lastOffset || after.lastIndex !== before.lastIndex;
      }, { timeout: 2000 }).toBe(true);
      await expect(frame.getByRole("button", { name: "閉じる", exact: true })).toHaveCount(0);
    });

    await check("animated-viewer-incoming-call", async () => {
      const next = { ...fixture, epoch: fixture.epoch + 1 };
      await send(next);
      await readySticker();
      await clickNative(sticker);
      await expect(frame.getByRole("button", { name: "閉じる", exact: true })).toBeAttached();
      next.controllerCall = {
        id: "incoming", title: "Incoming offline call", compact: true, callLayout: "incoming",
        items: [
          { id: "summary", kind: "call-summary", label: "Offline caller", description: "音声通話の着信", value: "A" },
          { id: "accept", kind: "button", label: "応答", symbol: "phone" },
          { id: "decline", kind: "button", label: "拒否", symbol: "hangup", danger: true },
        ],
      };
      await send(next);
      const answer = frame.getByRole("button", { name: "応答", exact: true });
      await expect(answer).toBeAttached();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(artifacts, `${mode}-viewer-incoming-call.png`) });
      await clickNative(answer);
      await expect.poll(() => page.evaluate(() =>
        window.actions.filter(a => a.action === "panel-action" && a.id === "accept").length
      ), { timeout: 2000 }).toBe(1);
      // Removing the foreground must restore the same animated viewer.
      await send({ ...next, controllerCall: null });
      await expect(frame.locator('img[alt="Audit animated sticker"]')).toBeVisible();
    });

    if (mode === "fluent") await check("fluent-submenu-keyboard-back", async () => {
      const menu = {
        mode, epoch: fixture.epoch + 2, dark: false, view: "chat",
        tabs: [{ id: "all", label: "All" }], rows: [],
        hostMenu: { id: "audit-menu", x: 30, y: 100, items: [
          { id: "sub", label: "Nested", children: [{ id: "child", label: "Child action", children: [] }] },
          { id: "root", label: "Root action", children: [] },
        ] },
      };
      const nested = frame.getByRole("button", { name: "Nested", exact: true });
      const child = frame.getByRole("button", { name: "Child action", exact: true });
      await send(menu);
      await expect(nested).toBeAttached(); await page.waitForTimeout(500);
      await clickNative(nested);
      await expect(child).toBeAttached(); await page.waitForTimeout(400);
      await page.mouse.move(389, 843);
      // Back must be reachable from any initial focus in the three-control cycle.
      for (let i = 0; i < 3 && await nested.count() === 0; i++) {
        await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
        await page.waitForTimeout(350);
      }
      await expect(nested).toHaveCount(1);
      await expect(child).toHaveCount(0);
      await clickNative(nested);
      await expect(child).toBeAttached(); await page.waitForTimeout(400);
      await page.mouse.move(389, 843);
      await page.keyboard.press("ArrowLeft");
      await expect(nested).toHaveCount(1);
      await expect(child).toHaveCount(0);
    });
  } finally {
    state.epoch = fixture.epoch + 10;
    await send({ ...state, chat: null, messages: [], hostMenu: null, nativePanel: null,
      controllerCall: null, controllerDialog: null });
    await expect(sticker).toHaveCount(0);
  }
  if (failures.length) throw new AggregateError(failures, `${mode}: media regressions failed`);
}
