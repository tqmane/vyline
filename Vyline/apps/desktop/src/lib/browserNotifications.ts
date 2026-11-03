import type { NoncallSettings } from "./settingsPreferences";
import { privacyPresentation } from "./settingsPreferences";
type PermissionApi = { permission: NotificationPermission; requestPermission: () => Promise<NotificationPermission> };

/** Called only by the settings toggle's user gesture, never by hydration/polling. */
export async function requestBrowserNotificationPermission(api?: PermissionApi): Promise<NotificationPermission | "unsupported"> {
  const target = api ?? (typeof Notification !== "undefined" ? Notification : undefined);
  if (!target) return "unsupported";
  if (target.permission !== "default") return target.permission;
  return target.requestPermission();
}

type Notice = { accountId: string; chatId: string; messageId: string; title: string; body: string; mine?: boolean; muted?: boolean };
type Runtime = { permission: string; background: boolean; show: (title: string, options: NotificationOptions) => void };
const delivered = new Set<string>();

/** Invoke only for live message events after the existing account/session guard. */
export function notifyBrowserMessage(notice: Notice, settings: { streamerMode: boolean } & Partial<NoncallSettings>, runtime?: Runtime): boolean {
  const key = JSON.stringify([notice.accountId, notice.chatId, notice.messageId]);
  if (delivered.has(key)) return false;
  delivered.add(key);
  if (delivered.size > 2000) delivered.delete(delivered.values().next().value!);
  const target: Runtime | undefined = runtime ?? (typeof Notification !== "undefined" && typeof document !== "undefined" ? {
    permission: Notification.permission,
    background: document.visibilityState !== "visible" || !document.hasFocus(),
    show: (title, options) => { new Notification(title, options); },
  } : undefined);
  if (!target || !settings.webNotificationsEnabled || target.permission !== "granted" || !target.background || notice.mine || notice.muted) return false;
  const mask = privacyPresentation(settings);
  try {
    target.show(mask.names ? "Vyline" : notice.title || "Vyline", { body: mask.notificationContent ? "新しいメッセージが届きました" : notice.body.slice(0, 160), tag: `vyline-message-${delivered.size}`, silent: true });
    return true;
  } catch { return false; }
}
