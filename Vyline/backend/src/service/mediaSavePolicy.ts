import { loadAccountSettings } from "./accountSettingsService.js";

export type MediaSavePreferences = { mediaAutoSave?: boolean };

export function mediaAutoSavePreference(storage: unknown): boolean {
  return (
    !storage ||
    typeof storage !== "object" ||
    (storage as MediaSavePreferences).mediaAutoSave !== false
  );
}

export async function loadMediaAutoSavePreference(mid: string): Promise<boolean> {
  if (!/^u[0-9a-f]{32}$/i.test(mid)) throw new Error("invalid account MID");
  return mediaAutoSavePreference((await loadAccountSettings(mid)).storage);
}

/** Display and browser downloads share the GET URL; neither overrides autosave OFF. */
export function shouldPersistMedia(options: { preview: boolean; mediaAutoSave: boolean }): boolean {
  return !options.preview && options.mediaAutoSave;
}
