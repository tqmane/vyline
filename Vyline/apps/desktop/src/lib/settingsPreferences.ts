import { maskMessageUrls } from "./messageUrls";

/** Shared contract for the parent store; all flags remain browser-local. */
export type NoncallSettings = {
  webNotificationsEnabled: boolean;
  hideNotificationContent: boolean;
  streamerMaskNames: boolean;
  streamerMaskAvatars: boolean;
  streamerMaskUrls: boolean;
  mediaAutoSave: boolean;
  requestUrlPreviews: boolean;
  linkPreviewMaxUrls: number;
};
export const NONCALL_SETTINGS_DEFAULTS: NoncallSettings = {
  webNotificationsEnabled: false,
  hideNotificationContent: true,
  streamerMaskNames: true,
  streamerMaskAvatars: true,
  streamerMaskUrls: true,
  mediaAutoSave: true,
  requestUrlPreviews: false,
  linkPreviewMaxUrls: 1,
};

export function privacyPresentation(settings: { streamerMode: boolean } & Partial<NoncallSettings>) {
  return {
    names: settings.streamerMode && settings.streamerMaskNames !== false,
    avatars: settings.streamerMode && settings.streamerMaskAvatars !== false,
    urls: settings.streamerMode && settings.streamerMaskUrls !== false,
    notificationContent: settings.streamerMode || settings.hideNotificationContent !== false,
  };
}

/** Use for displayed/copied text, including native controller payloads. */
export function maskPrivacyText(text: string, settings: { streamerMode: boolean } & Partial<NoncallSettings>, mentions?: readonly { S: number; E: number; all?: boolean }[]): string {
  const mask = privacyPresentation(settings);
  let result = text;
  if (mask.names && mentions) {
    let end = text.length;
    for (const mention of [...mentions].sort((a, b) => b.S - a.S)) {
      if (mention.all || !Number.isInteger(mention.S) || !Number.isInteger(mention.E) || mention.S < 0 || mention.E <= mention.S || mention.E > end) continue;
      result = `${result.slice(0, mention.S)}@メンバー${result.slice(mention.E)}`;
      end = mention.S;
    }
  }
  if (mask.urls) result = maskMessageUrls(result);
  if (mask.names) result = result.replace(/\b[ucr][0-9a-f]{32}\b/gi, "[ID]").replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[連絡先]");
  return result;
}
