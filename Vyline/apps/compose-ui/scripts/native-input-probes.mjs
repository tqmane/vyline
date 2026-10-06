import assert from "node:assert/strict";

export async function runNativeInputProbes({ page, frame, state, expect, clickNative }) {
  const mode = state.mode;
  const fixture = { mode, epoch: (state.epoch ?? 1) + 100, view: "settings", dark: false,
    reducedMotion: true, chat: null, messages: [], rows: [], tabs: [],
    nativePanel: { id: `input-${mode}`, title: "Offline input", items: [
      { id: `${mode}:first`, kind: "input", label: "MID fixture", value: "", ackSeq: 0 },
      { id: `${mode}:second`, kind: "input", label: "Second fixture", value: "", ackSeq: 0 },
    ] },
  };
  await page.evaluate(fixture => {
    window.__inputFixture = { fixture, hold: false, changes: [] };
    window.__inputListener = event => {
      const value = event.data;
      if (event.source !== document.querySelector("iframe").contentWindow || event.origin !== location.origin || value?.action !== "panel-change") return;
      const current = window.__inputFixture;
      const item = current.fixture.nativePanel.items.find(item => item.id === value.id);
      if (!item) return;
      current.changes.push(value);
      if (current.hold) return;
      item.ackSeq = value.inputSeq;
      if (value.value !== "reject") item.value = value.value.trim();
      window.sendSnapshot(current.fixture);
    };
    addEventListener("message", window.__inputListener);
    window.sendSnapshot(fixture);
  }, fixture);
  const field = frame.getByRole("textbox", { name: "MID fixture", exact: true });
  const second = frame.getByRole("textbox", { name: "Second fixture", exact: true });
  const replace = async (control, text) => {
    await expect(control).toBeAttached(); await clickNative(control);
    await page.keyboard.press("Control+A"); await page.keyboard.insertText(text);
  };
  const sendFirst = (value, ackSeq) => page.evaluate(({ value, ackSeq }) => {
    const current = window.__inputFixture;
    current.fixture.nativePanel.items[0] = { ...current.fixture.nativePanel.items[0], value, ackSeq };
    window.sendSnapshot(current.fixture);
  }, { value, ackSeq });
  try {
    await replace(field, " canonical ");
    await expect(field).toHaveText("canonical");
    await replace(field, "reject");
    await expect(field).toHaveText("canonical");
    const acknowledged = await page.evaluate(() => window.__inputFixture.fixture.nativePanel.items[0].ackSeq);
    assert(Number.isSafeInteger(acknowledged) && acknowledged > 0);
    await sendFirst("", acknowledged);
    await expect(field).toHaveText("");
    await page.evaluate(() => { window.__inputFixture.hold = true; });
    await replace(field, "new draft");
    await expect.poll(() => page.evaluate(() => window.__inputFixture.changes.at(-1)?.value)).toBe("new draft");
    const latest = await page.evaluate(() => window.__inputFixture.changes.at(-1).inputSeq);
    await sendFirst("late old echo", acknowledged);
    await expect(field).toHaveText("new draft");
    await sendFirst("new draft", latest);
    await expect(field).toHaveText("new draft");
    await sendFirst("late old echo", acknowledged);
    await expect(field).toHaveText("new draft");
    await sendFirst("reset after acknowledgement", latest);
    await expect(field).toHaveText("reset after acknowledgement");
    await page.evaluate(() => { window.__inputFixture.hold = false; });
    await replace(second, " 日本語の入力 ");
    await expect(second).toHaveText("日本語の入力");
    await expect(field).toHaveText("reset after acknowledgement");
    await page.evaluate(() => {
      const current = window.__inputFixture;
      current.removed = current.fixture.nativePanel.items.shift();
      window.sendSnapshot(current.fixture);
    });
    await expect(field).toHaveCount(0);
    await page.evaluate(() => {
      const current = window.__inputFixture;
      current.fixture.nativePanel.items.unshift(current.removed);
      window.sendSnapshot(current.fixture);
    });
    await expect(field).toHaveText("reset after acknowledgement");
    await replace(field, " remounted ");
    await expect(field).toHaveText("remounted");
    const finalSeq = await page.evaluate(() => window.__inputFixture.fixture.nativePanel.items[0].ackSeq);
    assert(finalSeq > latest, "remount must not reuse a retired input sequence");
    console.log(`${mode}: normalization, rejection, reset, delayed echoes, separate fields and remount PASS`);
  } finally {
    state.epoch = fixture.epoch + 10;
    await page.evaluate(state => { removeEventListener("message", window.__inputListener); window.sendSnapshot({ ...state, nativePanel: null }); }, state);
  }
}
