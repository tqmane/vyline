import { expect, test } from "bun:test";
import { notifyBrowserMessage, requestBrowserNotificationPermission } from "./browserNotifications";
import { privacyPresentation } from "./settingsPreferences";

test("permission is requested only when explicitly called and handles granted/denied/default", async () => {
  let calls = 0;
  const requestPermission = async () => { calls++; return "granted" as const; };
  expect(await requestBrowserNotificationPermission({ permission: "denied", requestPermission })).toBe("denied");
  expect(await requestBrowserNotificationPermission({ permission: "granted", requestPermission })).toBe("granted"); expect(calls).toBe(0);
  expect(await requestBrowserNotificationPermission({ permission: "default", requestPermission })).toBe("granted"); expect(calls).toBe(1);
});

test("notifications mask private content, isolate accounts and deduplicate polling", () => {
  const shown: Array<{ title: string; body?: string }> = [];
  const runtime = { permission: "granted", background: true, show: (title: string, options: NotificationOptions) => { shown.push({ title, body: options.body }); } };
  const notice = { accountId: "a", chatId: "chat", messageId: "notify-1", title: "private name", body: "private body" };
  const settings = { streamerMode: true, webNotificationsEnabled: true, hideNotificationContent: false };
  expect(notifyBrowserMessage(notice, settings, runtime)).toBe(true); expect(notifyBrowserMessage(notice, settings, runtime)).toBe(false);
  expect(shown[0]?.title).toBe("Vyline"); expect(shown[0]?.body).not.toContain("private");
  expect(notifyBrowserMessage({ ...notice, accountId: "b" }, { ...settings, streamerMode: false }, runtime)).toBe(true);
  expect(shown[1]).toEqual({ title: "private name", body: "private body" });
  for (const [i, change] of [{ permission: "denied" }, { background: false }].entries()) expect(notifyBrowserMessage({ ...notice, messageId: `notify-${i + 10}` }, settings, { ...runtime, ...change })).toBe(false);
  expect(notifyBrowserMessage({ ...notice, messageId: "mine", mine: true }, settings, runtime)).toBe(false);
});

test("each privacy mask is independent and defaults to safe while streamer mode is on", () => {
  expect(privacyPresentation({ streamerMode: true })).toEqual({ names: true, avatars: true, urls: true, notificationContent: true });
  expect(privacyPresentation({ streamerMode: true, streamerMaskNames: false, streamerMaskAvatars: false, streamerMaskUrls: false })).toEqual({ names: false, avatars: false, urls: false, notificationContent: true });
  expect(privacyPresentation({ streamerMode: false, hideNotificationContent: false })).toEqual({ names: false, avatars: false, urls: false, notificationContent: false });
});
