import { expect, test } from "bun:test";
import { mediaAutoSavePreference, shouldPersistMedia } from "./mediaSavePolicy";

test("autosave defaults preserve existing behavior, explicit OFF is account-local", () => {
  expect(mediaAutoSavePreference(undefined)).toBe(true);
  expect(mediaAutoSavePreference({ autoDownload: false })).toBe(true);
  expect(mediaAutoSavePreference({ mediaAutoSave: false })).toBe(false);
  expect(mediaAutoSavePreference({ mediaAutoSave: true })).toBe(true);
});
test("autosave OFF keeps temporary display independent of explicit original download", () => {
  expect(shouldPersistMedia({ preview: false, mediaAutoSave: false })).toBe(false);
  expect(shouldPersistMedia({ preview: false, mediaAutoSave: true })).toBe(true);
  expect(shouldPersistMedia({ preview: true, mediaAutoSave: true })).toBe(false);
});
