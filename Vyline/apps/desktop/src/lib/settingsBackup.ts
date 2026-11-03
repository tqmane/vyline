import type { Settings } from "./store-types";
import type { VyTheme } from "@vyline/themes";
import type { VyThemeId, VyThemeTokens } from "../stores/themeStore";
import { BETA_FEATURES, recordBetaFeatureDecisions } from "./betaConsent";
import type { NoncallSettings } from "./settingsPreferences";
import type { DesignPreferences } from "../ui/design-system-store";

export const SETTINGS_BACKUP_MAX_BYTES = 15_000_000;
type Preferences = Settings & Partial<NoncallSettings>;
type Snapshot = { settings: Preferences; theme: VyTheme; visualTheme: { themeId: VyThemeId; custom: VyThemeTokens }; design?: DesignPreferences };
export type SettingsRestore = { settings: Partial<Preferences>; theme?: VyTheme; visualTheme?: Snapshot["visualTheme"]; design?: DesignPreferences };
const BOOLEAN_SETTINGS = [
  "streamerMode", "compactDensity", "enterToSend", "alwaysMuteMessages", "bubbleTail", "showStatusMessage", "showBackground", "highQualityImages",
  "webNotificationsEnabled", "hideNotificationContent", "streamerMaskNames", "streamerMaskAvatars", "streamerMaskUrls", "mediaAutoSave", "requestUrlPreviews",
] as const;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const invalid = () => { throw new Error("設定値の形式または範囲が正しくありません"); };
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

function color(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 80) return false;
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(v) || v === "transparent") return true;
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(0?(?:\.\d+)|1(?:\.0+)?))?\s*\)$/i.exec(v);
  return !!rgb && rgb.slice(1, 4).every(n => Number(n) <= 255) && (!v.startsWith("rgba") || rgb[4] !== undefined);
}

export function safeThemeImage(v: unknown): v is string | null {
  if (v === null || v === "") return true;
  if (typeof v !== "string" || v.length > 14_000_000) return false;
  if (v.startsWith("https://")) {
    try { const u = new URL(v); return v.length <= 2048 && !u.username && !u.password && !u.search && !u.hash; }
    catch { return false; }
  }
  const data = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (!data || data[2]!.length % 4 !== 0) return false;
  try {
    const head = atob(data[2]!.slice(0, 24));
    return data[1] === "png" ? head.startsWith("\x89PNG\r\n\x1a\n") : data[1] === "jpeg" ? head.startsWith("\xff\xd8\xff") :
      data[1] === "gif" ? /^GIF8[79]a/.test(head) : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  } catch { return false; }
}

export function parseSettingsBackup(text: string, current: Snapshot): SettingsRestore {
  if (bytes(text) > SETTINGS_BACKUP_MAX_BYTES) throw new Error("設定JSONは15MBまでです");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("JSONを読み取れません"); }
  if (!record(raw) || (raw.version !== 1 && raw.version !== 2) ||
    (raw.format !== "vyline-settings-backup" && raw.format !== "vyline-local-settings" && !(raw.version === 1 && raw.format === undefined)))
    throw new Error("対応していない設定バックアップです");
  const result: SettingsRestore = { settings: {} };
  if (raw.settings !== undefined) {
    if (!record(raw.settings)) invalid();
    const input = raw.settings as Record<string, unknown>;
    for (const key of BOOLEAN_SETTINGS) if (Object.prototype.hasOwnProperty.call(input, key)) {
      if (typeof input[key] !== "boolean") invalid();
      (result.settings as Record<string, unknown>)[key] = input[key];
    }
    for (const [key, options] of Object.entries({ animationMode: ["vyline", "feather", "none"], chatSort: ["recent", "unread", "custom"] })) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
      if (!options.includes(input[key] as string)) invalid();
      (result.settings as Record<string, unknown>)[key] = input[key];
    }
    for (const [key, min, max] of [["fontScale", 0.85, 1.25], ["linkPreviewMaxUrls", 0, 3]] as const) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
      const n = input[key];
      if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max || key === "linkPreviewMaxUrls" && !Number.isInteger(n)) invalid();
      (result.settings as Record<string, unknown>)[key] = n;
    }
  }
  for (const [section, baseline] of [["theme", current.theme], ["visualTheme", current.visualTheme]] as const) {
    if (raw[section] === undefined) continue;
    if (!record(raw[section])) invalid();
    const input = raw[section] as Record<string, unknown>;
    if (section === "theme") {
      const theme = { ...baseline } as VyTheme;
      for (const key of Object.keys(current.theme).concat("chatImage")) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        const v = input[key];
        if (key === "chatImage") { if (!safeThemeImage(v)) invalid(); }
        else if (key === "radius") { if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 4) invalid(); }
        else if (key === "pattern") { if (v !== 0 && v !== 1) invalid(); }
        else if (key === "id" || key === "name") { if (typeof v !== "string" || v.length > 128) invalid(); }
        else if (!color(v)) invalid();
        (theme as unknown as Record<string, unknown>)[key] = key === "chatImage" && v === null ? undefined : v;
      }
      result.theme = theme;
    } else {
      const themeId = input.themeId ?? current.visualTheme.themeId;
      if (!["telegram-night", "line-dark", "soft-day", "custom"].includes(themeId as string)) invalid();
      const custom = { ...current.visualTheme.custom };
      if (input.custom !== undefined && !record(input.custom)) invalid();
      if (record(input.custom)) for (const key of Object.keys(custom).concat("chatBgImage")) {
        if (!Object.prototype.hasOwnProperty.call(input.custom, key)) continue;
        const v = input.custom[key];
        if (key === "chatBgImage") { if (!safeThemeImage(v)) invalid(); }
        else if (key === "messageRadiusPx") { if (typeof v !== "number" || !Number.isFinite(v) || v < 4 || v > 40) invalid(); }
        else if (!color(v)) invalid();
        (custom as unknown as Record<string, unknown>)[key] = v;
      }
      result.visualTheme = { themeId: themeId as VyThemeId, custom };
    }
  }
  if (raw.design !== undefined) {
    if (!record(raw.design) || !["legacy", "apple", "fluent", "miuix", "nezu"].includes(raw.design.mode as string) ||
      !["system", "light", "dark"].includes(raw.design.appearance as string)) invalid();
    const design = raw.design as DesignPreferences;
    result.design = { mode: design.mode, appearance: design.appearance };
  }
  if (!Object.keys(result.settings).length && !result.theme && !result.visualTheme && !result.design && !record(raw.settings))
    throw new Error("復元できる設定がありません");
  for (const key of Object.keys(BETA_FEATURES) as (keyof typeof BETA_FEATURES)[]) result.settings[key] = false;
  return result;
}

export function createSettingsBackup(current: Snapshot): string {
  const safe = parseSettingsBackup(JSON.stringify({ format: "vyline-settings-backup", version: 2, ...current }), current);
  return JSON.stringify({ format: "vyline-settings-backup", version: 2, exportedAt: new Date().toISOString(), ...safe }, null, 2);
}

/** Persist revocation before touching preferences; callers roll back failed writes. */
export function recordSettingsRestoreConsent(): void {
  if (!recordBetaFeatureDecisions(Object.values(BETA_FEATURES), "disabled_by_restore"))
    throw new Error("ベータ撤回履歴を保存できないため、復元を中止しました");
}
