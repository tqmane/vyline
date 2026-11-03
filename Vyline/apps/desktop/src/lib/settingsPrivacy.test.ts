import { expect, test } from "bun:test";
import { maskPrivacyText } from "./settingsPreferences";

test("privacy masks known mention names before URLs without mutating text or hiding ALL", () => {
  const text = "😀 @Private Name @ALL https://private.example/path。";
  const mentions = [{ S: text.indexOf("@Private"), E: text.indexOf(" @ALL") },
    { S: text.indexOf("@ALL"), E: text.indexOf("@ALL") + 4, all: true }];
  const settings = { streamerMode: true, streamerMaskNames: true, streamerMaskUrls: true };
  expect(maskPrivacyText(text, settings, mentions)).toBe("😀 @メンバー @ALL [URL]。");
  expect(maskPrivacyText(text, { ...settings, streamerMaskUrls: false }, mentions)).toBe("😀 @メンバー @ALL https://private.example/path。");
  expect(maskPrivacyText(text, { ...settings, streamerMaskNames: false }, mentions)).toBe("😀 @Private Name @ALL [URL]。");
  expect(maskPrivacyText(text, { ...settings, streamerMode: false }, mentions)).toBe(text);
  expect(mentions[0]).toEqual({ S: 3, E: 16 });
});
