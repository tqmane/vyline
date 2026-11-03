import { expect, test } from "bun:test";
import { THEME_PRESETS } from "@vyline/themes";
import { createSettingsBackup, parseSettingsBackup, safeThemeImage } from "./settingsBackup";
import type { Settings } from "./store-types";
import { VY_THEME_PRESETS } from "../stores/themeStore";
const current = { settings: { fontScale: 1, streamerMode: false, betaAgentI: true, readReceipts: false, showReaderList: true, proxyUrl: "http://user:secret@localhost", animationMode: "vyline", chatSort: "recent" } as Settings,
  theme: THEME_PRESETS[0]!, visualTheme: { themeId: "telegram-night" as const, custom: VY_THEME_PRESETS["telegram-night"] } };
const encode = (patch: object) => JSON.stringify({ format: "vyline-settings-backup", version: 2, ...patch });

test("JSON backup round trip excludes secrets, identities, history and protected settings and disables beta", () => {
  const json = createSettingsBackup(current);
  expect(json).not.toContain("secret"); expect(json).not.toContain("readReceipts"); expect(json).not.toContain("showReaderList");
  const result = parseSettingsBackup(json, current);
  expect(result.theme).toEqual(current.theme);
  expect(result.settings.betaAgentI).toBe(false);
  expect(parseSettingsBackup(encode({ settings: { fontScale: 1.2, token: "fixture-secret", readReceipts: true }, localNames: { id: "person" }, tosConsent: true }), current).settings)
    .toEqual({ fontScale: 1.2, betaAgentI: false, betaBlockCheckManual: false, betaBlockCheckAuto: false, betaMidSearch: false });
});

test("v1 partial settings merge, UI design and omitted optional background are restored", () => {
  const parsed = parseSettingsBackup(JSON.stringify({ version: 1, settings: { streamerMode: true }, theme: { chatImage: null }, design: { mode: "miuix", appearance: "dark" } }), current);
  expect(parsed.settings.fontScale).toBeUndefined(); expect(parsed.settings.streamerMode).toBe(true);
  expect(parsed.theme?.accent).toBe(current.theme.accent); expect(parsed.theme?.chatImage).toBeUndefined();
  expect(parsed.design?.mode).toBe("miuix");
});

test("bad JSON, unknown version, dangerous colors/images and invalid ranges fail before any mutation", () => {
  for (const text of ["{", encode({ version: 3 }), encode({ settings: { fontScale: 100 } }), encode({ settings: { linkPreviewMaxUrls: 4 } }),
    encode({ settings: { linkPreviewMaxUrls: 1.5 } }), encode({ theme: { accent: "url(https://example.test)" } }),
    encode({ theme: { chatImage: "data:image/svg+xml;base64,PHN2Zz4=" } }), encode({ theme: { chatImage: "data:image/png;base64,ZmFrZQ==" } }),
    encode({ visualTheme: { themeId: "missing" } }), encode({ design: { mode: "missing", appearance: "dark" } }),
    encode({ theme: { chatImage: "https://user:password@example.test/a" } }), " ".repeat(15_000_001)]) {
    expect(() => parseSettingsBackup(text, current)).toThrow();
  }
  expect(current.settings.betaAgentI).toBe(true);
});

test("preview request defaults are not activated by absent data; strict allowed values restore", () => {
  expect(parseSettingsBackup(encode({ settings: {} }), current).settings.requestUrlPreviews).toBeUndefined();
  expect(parseSettingsBackup(encode({ settings: { requestUrlPreviews: false, linkPreviewMaxUrls: 0 } }), current).settings.linkPreviewMaxUrls).toBe(0);
  expect(safeThemeImage("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
  expect(safeThemeImage("https://example.test/bg.png?token=fixture")).toBe(false);
});
