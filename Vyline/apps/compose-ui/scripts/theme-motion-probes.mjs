/** Real built-Wasm probes, called by smoke.mjs --chat --motion.
 * Account-free bridge fixtures only. Never connect to LINE or a production account.
 * Captured pixels are evidence from the built renderer, not a CSS recreation.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function runThemeMotionProbes({ page, frame, state, artifacts, expect, clickNative }) {
  const output = join(artifacts, "motion", state.mode);
  await mkdir(output, { recursive: true });
  const results = [];
  const button = (name) => frame.getByRole("button", { name, exact: true });
  const patch = (value) => page.evaluate((value) => window.sendPatch(value), value);
  const capture = (name, clip) => page.screenshot({ path: join(output, `${name}.png`), animations: "allow", ...(clip ? { clip } : {}) });
  const difference = async (first, second) => page.evaluate(async ([a, b]) => {
    async function decode(data) {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    const [left, right] = await Promise.all([decode(a), decode(b)]);
    if (left.length !== right.length) throw new Error("Pixel evidence must use identical crop geometry");
    let changed = 0;
    for (let i = 0; i < left.length; i += 4)
      if (Math.max(Math.abs(left[i] - right[i]), Math.abs(left[i + 1] - right[i + 1]), Math.abs(left[i + 2] - right[i + 2])) > 2) changed++;
    return changed;
  }, [first.toString("base64"), second.toString("base64")]);
  const originalViewport = page.viewportSize();
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      for (const dark of [false, true]) {
        const name = `${viewport.width}-${dark ? "dark" : "light"}`;
        await page.setViewportSize(viewport);
        const message = { ...state.messages.at(-1), id: "motion-own", authorId: "me", text: "モーション検証用メッセージ", status: "sent", canReact: true };
        const fixture = { ...state, dark, reducedMotion: false, hostMenu: null,
          chat: { ...state.chat, id: "motion-chat", canCall: true },
          messages: [message], composer: { ...state.composer, text: "", pending: [] } };
        await page.evaluate((value) => { window.actions = []; window.sendSnapshot(value); }, fixture);
        const editor = frame.getByRole("textbox", { name: "メッセージを入力", exact: true });
        await expect(editor).toHaveCount(1);
        await page.waitForTimeout(900);
        await page.mouse.move(1, 1);
        const control = button(state.mode === "apple" ? (viewport.width < 760 ? "ビデオ通話" : "トークの操作") : "設定").last();
        const bounds = await control.boundingBox(); assert(bounds && bounds.width > 0 && bounds.height > 0);
        const x = Math.max(0, Math.floor(bounds.x - 12)); const y = Math.max(0, Math.floor(bounds.y - 12));
        const clip = { x, y, width: Math.min(viewport.width - x, Math.ceil(bounds.width + 24)), height: Math.min(viewport.height - y, Math.ceil(bounds.height + 24)) };
        const idle = await capture(`${name}-idle`, clip);
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.waitForTimeout(160);
        const hovered = await capture(`${name}-hover`, clip);
        await page.mouse.down(); await page.waitForTimeout(45);
        const pressedEarly = await capture(`${name}-press-early`, clip);
        await page.waitForTimeout(160);
        const pressed = await capture(`${name}-press-settled`, clip);
        // Cancel outside the control so this test cannot accidentally invoke calling/settings.
        await page.mouse.move(1, 1); await page.mouse.up(); await page.waitForTimeout(650);
        assert.equal(await page.evaluate(() => window.actions.some((a) => ["call", "settings", "chat-menu"].includes(a.action))), false);
        const pressPixels = await difference(hovered, pressed);
        assert(pressPixels > 8, `${state.mode}: native press must visibly respond`);
        const hoverPixels = await difference(idle, hovered);
        if (state.mode === "fluent") assert(hoverPixels > 8, "Fluent hover must visibly respond");

        const bubble = button(message.text);
        const bubbleBounds = await bubble.boundingBox(); assert(bubbleBounds);
        await page.mouse.click(bubbleBounds.x + bubbleBounds.width / 2, bubbleBounds.y + bubbleBounds.height / 2, { button: "right" });
        await expect(button("返信")).toBeAttached();
        await capture(`${name}-message-menu-entry`);
        await page.waitForTimeout(650);
        await capture(`${name}-message-menu-settled`);
        await clickNative(button("編集"));
        const editField = frame.getByRole("textbox", { name: "編集するメッセージ", exact: true });
        await expect(editField).toBeAttached(); await page.waitForTimeout(650);
        await expect(editField).toHaveText(message.text);
        await capture(`${name}-native-editor-dialog`);
        await clickNative(button("変更を保存"));
        await page.waitForFunction(() => window.actions.some((a) => a.action === "edit" && a.id === "motion-own"));
        await expect(editField).toHaveCount(0);

        const menu = { id: "motion-host", x: viewport.width - 36, y: 130,
          items: [{ id: "motion-command", label: "検証コマンド" },
            { id: "motion-submenu", label: "階層メニュー", children: [{ id: "motion-nested", label: "階層の検証コマンド" }] }] };
        await patch({ hostMenu: menu });
        await expect(button("階層メニュー")).toBeAttached(); await page.waitForTimeout(700);
        await capture(`${name}-host-menu`);
        if (state.mode === "fluent") {
          const submenu = await button("階層メニュー").boundingBox(); assert(submenu);
          await page.mouse.move(submenu.x + submenu.width / 2, submenu.y + submenu.height / 2);
        } else await clickNative(button("階層メニュー"));
        await expect(button("階層の検証コマンド")).toBeAttached(); await page.waitForTimeout(650);
        await capture(`${name}-submenu`);
        await clickNative(button("階層の検証コマンド"));
        await page.waitForFunction(() => window.actions.some((a) => a.action === "host-menu" && a.id === "motion-nested"));
        await patch({ hostMenu: null });
        await page.waitForTimeout(35); await capture(`${name}-menu-exit`);
        await expect(button("階層の検証コマンド")).toHaveCount(0);
        await page.waitForTimeout(650); await capture(`${name}-menu-closed`);

        // Only one live composer/history, including during route entry and interrupted motion.
        await patch({ chat: { ...fixture.chat, id: "motion-next", title: "次の会話" } });
        await expect(editor).toHaveCount(1);
        await expect(frame.getByRole("list", { name: "メッセージ履歴", exact: true })).toHaveCount(1);
        await page.waitForTimeout(40); await capture(`${name}-navigation-entry`);
        await page.waitForTimeout(650); await capture(`${name}-navigation-settled`);
        await patch({ reducedMotion: true, chat: { ...fixture.chat, id: "motion-reduced" } });
        await page.waitForTimeout(120); const reducedStart = await editor.boundingBox();
        await page.waitForTimeout(450); const reducedEnd = await editor.boundingBox();
        assert(reducedStart && reducedEnd && Math.abs(reducedStart.x - reducedEnd.x) <= 1 && Math.abs(reducedStart.y - reducedEnd.y) <= 1,
          "Reduced-motion route geometry must be stable");
        results.push({ mode: state.mode, viewport, dark, pressPixels, hoverPixels,
          temporalPressPixels: await difference(pressedEarly, pressed),
          nativeMenu: true, nativeEditAction: true, nativeSubmenuAction: true, singleLiveRoute: true, reducedRouteStable: true });
      }
    }
  } finally {
    await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
    if (originalViewport) await page.setViewportSize(originalViewport);
    await page.evaluate((state) => window.sendSnapshot(state), state);
  }
  return results;
}
