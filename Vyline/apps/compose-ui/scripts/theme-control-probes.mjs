import assert from "node:assert/strict";
import { join } from "node:path";

export async function runThemeControlProbes({ page, frame, state, artifacts, expect, clickNative }) {
  const mode = state.mode;
  if (mode === "fluent") await page.setViewportSize({ width: 1440, height: 1000 });
  else await page.setViewportSize({ width: 390, height: 844 });
  const fixture = { mode, epoch: (state.epoch ?? 1) + 100, view: "settings", dark: false,
    reducedMotion: true, chat: null, messages: [], rows: [], tabs: [], nativePanel: {
      id: `controls-${mode}`, title: "Offline theme controls", items: [
        { id: "section", kind: "section", label: "Theme controls", items: [
          ...(mode === "fluent" ? [{ id: "long-row", kind: "row", label: "Long caption fixture",
            description: "長い説明でも右側の操作が消えず、ボタンの幅がゼロにならないことを確認します。".repeat(3),
            items: [{ id: "long-button", kind: "button", label: "Long caption action" }] }] : []),
          { id: "toggle-row", kind: "row", label: "Toggle fixture", description: "Native settings row",
            items: [{ id: "toggle", kind: "toggle", label: "Toggle fixture", value: "false" }] },
          { id: "choice", kind: "choice", label: "Choice fixture", value: "false" },
          { id: "disabled", kind: "choice", label: "Disabled choice", value: "false", disabled: true },
          { id: "select", kind: "select", label: "Selection fixture", showLabel: true, value: "first",
            options: [{ value: "first", label: "First" }, { value: "second", label: "Second" }] },
          { id: "slider", kind: "slider", label: "Scale fixture", value: "2", minimum: 0, maximum: 10, step: 1 },
          { id: "button", kind: "button", label: "Primary fixture", primary: true },
        ] },
      ],
    } };
  await page.evaluate(fixture => { window.actions = []; window.sendSnapshot(fixture); }, fixture);
  const action = async (id, value) => expect.poll(() => page.evaluate(({ id, value }) =>
    window.actions.some(item => item.id === id && (value === undefined || item.value === value)), { id, value })).toBe(true);
  if (mode === "fluent") { await clickNative(frame.getByRole("button", { name: "Long caption action", exact: true })); await action("long-button"); }
  await clickNative(frame.getByRole("radio", { name: "Choice fixture", exact: true }));
  await action("choice", "true");
  if (mode === "fluent") {
    const radio = await frame.getByRole("radio", { name: "Choice fixture", exact: true }).boundingBox();
    assert(radio);
    await page.mouse.click(radio.x + 26, radio.y + radio.height / 2);
    await expect.poll(() => page.evaluate(() => window.actions.filter(item => item.id === "choice").length)).toBe(2);
  }
  await clickNative(frame.getByRole("radio", { name: "Disabled choice", exact: true }));
  assert.equal(await page.evaluate(() => window.actions.some(item => item.id === "disabled")), false);
  await clickNative(frame.getByRole("switch", { name: "Toggle fixture", exact: true }));
  await action("toggle", "true");
  if (mode === "fluent") await clickNative(frame.getByText("First", { exact: true }));
  if (mode === "miuix") await clickNative(frame.getByRole("button", { name: "Selection fixture", exact: true }));
  await clickNative(mode === "apple" ? frame.getByRole("button", { name: "Second", exact: true }) : frame.getByText("Second", { exact: true }));
  await action("select", "second");
  if (mode !== "apple") await expect(frame.getByText("Second", { exact: true })).toHaveCount(0);
  if (mode !== "apple") {
    const trigger = mode === "fluent" ? frame.getByText("First", { exact: true }) : frame.getByRole("button", { name: "Selection fixture", exact: true });
    await clickNative(trigger);
    await expect(frame.getByText("Second", { exact: true })).toBeAttached();
    const retired = await frame.getByText("Second", { exact: true }).boundingBox();
    assert(retired);
    const select = fixture.nativePanel.items[0].items.find(item => item.id === "select");
    select.disabled = true;
    await page.evaluate(fixture => window.sendSnapshot(fixture), fixture);
    await expect(frame.getByText("Second", { exact: true })).toHaveCount(0);
    await page.mouse.click(retired.x + retired.width / 2, retired.y + retired.height / 2);
    assert.equal(await page.evaluate(() => window.actions.filter(item => item.id === "select").length), 1);
    select.disabled = false;
    await page.evaluate(fixture => window.sendSnapshot(fixture), fixture);
    await expect(trigger).toBeAttached();
    await expect(frame.getByText("Second", { exact: true })).toHaveCount(0);
  }
  const slider = frame.getByLabel("Scale fixture", { exact: true }).first();
  const rect = await slider.boundingBox();
  assert(rect);
  await page.mouse.move(rect.x + rect.width * .2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .6, rect.y + rect.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.actions.some(item => item.id === "slider" && Number(item.value) > 2))).toBe(true);
  const beforeKey = await page.evaluate(() => Number(window.actions.filter(item => item.id === "slider").at(-1).value));
  await page.keyboard.press("ArrowRight");
  await action("slider", `${Math.min(10, beforeKey + 1)}.0`);
  await clickNative(frame.getByRole("button", { name: "Primary fixture", exact: true }));
  await action("button");
  await page.screenshot({ path: join(artifacts, `${mode}-native-controls.png`) });
  console.log(`${mode}: native choice, disabled, switch, dropdown, slider and button PASS`);
  state.epoch = fixture.epoch + 10;
  await page.evaluate(state => window.sendSnapshot({ ...state, nativePanel: null }), state);
}
