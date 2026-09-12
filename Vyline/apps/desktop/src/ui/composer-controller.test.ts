import { expect, test } from "bun:test";
import {
  clampComposerSelection,
  composerReplyPreview,
  composerSelectionForDraft,
  getComposerController,
  publishComposerController,
  subscribeComposerControllers,
  unregisterComposerController,
  type ComposerController,
} from "./composer-controller";

test("only the current mounted composer may unregister a chat", () => {
  const first = Symbol("first pane");
  const replacement = Symbol("replacement pane");
  const original = {
    snapshot: { chatId: "registry-test-chat", text: "kept draft" },
  } as ComposerController;
  const current = { ...original, snapshot: { ...original.snapshot, text: "latest draft" } };
  let updates = 0;
  const unsubscribe = subscribeComposerControllers(() => {
    updates++;
  });
  publishComposerController(first, original);
  publishComposerController(replacement, current);
  unregisterComposerController("registry-test-chat", first);
  expect(getComposerController("registry-test-chat")).toBe(current);
  expect(updates).toBe(2);
  publishComposerController(replacement, current);
  expect(updates).toBe(2);
  unregisterComposerController("registry-test-chat", replacement);
  expect(getComposerController("registry-test-chat")).toBeNull();
  expect(updates).toBe(3);
  unsubscribe();
  publishComposerController(first, original);
  unregisterComposerController("registry-test-chat", first);
  expect(updates).toBe(3);
});

test("native cursor ranges are bounded in UTF-16 units", () => {
  expect(clampComposerSelection("a😀b")).toEqual({ start: 4, end: 4 });
  expect(clampComposerSelection("a😀b", 1, 3)).toEqual({ start: 1, end: 3 });
  expect(clampComposerSelection("abc", -4, 99)).toEqual({ start: 0, end: 3 });
  expect(clampComposerSelection("abc", 2, 1)).toEqual({ start: 2, end: 2 });
  expect(clampComposerSelection("abc", Number.NaN)).toEqual({ start: 3, end: 3 });
});

test("draft and reply projections never mix a stale controller snapshot with newer store state", () => {
  const snapshot = {
    text: "old draft",
    selectionStart: 2,
    selectionEnd: 5,
    replyToId: "old-reply",
    replyText: "old preview",
  } as ComposerController["snapshot"];

  expect(composerSelectionForDraft("new draft", snapshot)).toEqual({ start: 9, end: 9 });
  expect(composerReplyPreview(snapshot, "new-reply", "new preview")).toBe("new preview");

  const current = { ...snapshot, text: "new draft", selectionStart: 1, selectionEnd: 4, replyToId: "new-reply", replyText: "fresh preview" };
  expect(composerSelectionForDraft("new draft", current)).toEqual({ start: 1, end: 4 });
  expect(composerReplyPreview(current, "new-reply", "new preview")).toBe("fresh preview");
});
