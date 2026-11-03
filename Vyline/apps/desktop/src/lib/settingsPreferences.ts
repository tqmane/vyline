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
export function maskPrivacyText(text: string, settings: { streamerMode: boolean } & Partial<NoncallSettings>): string {
  const mask = privacyPresentation(settings);
  let result = mask.urls ? text.replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, "[URL]") : text;
  if (mask.names) result = result.replace(/\b[ucr][0-9a-f]{32}\b/gi, "[ID]").replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[連絡先]");
  return result;
}
