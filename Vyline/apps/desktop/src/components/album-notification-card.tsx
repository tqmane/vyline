import { useState } from "react";
import { useStore, type Message } from "../lib/store";
import { maskPrivacyText } from "../lib/settingsPreferences";
import { AlbumModal } from "./album-modal";

export function AlbumNotificationCard({ message, accountId }: { message: Message; accountId?: string }) {
  const currentAccount = useStore(state => state.accountId);
  const settings = useStore(state => state.settings);
  const notification = message.postNotification;
  const albumId = notification?.albumId;
  const key = `${accountId}:${message.chatId}:${message.id}:${albumId}`;
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    if (!accountId || currentAccount !== accountId) { setError("ログイン後に利用できます。"); return; }
    if (!albumId || !message.chatId) { setError("アルバムIDがないため表示できません"); return; }
    setError(null); setOpened(key);
  };
  return <div className="my-1 flex w-full justify-center px-2">
    <button type="button" onClick={open} className="w-full max-w-[360px] overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 py-3 text-left shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--vy-accent)]">Album</p>
      <p className="mt-1 text-sm font-semibold">{maskPrivacyText(notification?.title || "アルバムが更新されました", settings)}</p>
      {notification?.mediaCount != null && <p className="mt-1 text-xs text-[var(--vy-text-dim)]">{notification.mediaCount}件のメディア</p>}
      {error ? <p role="alert" className="mt-2 text-xs text-[var(--vy-danger)]">{error} · 再読み込み</p> : <p className="mt-2 text-xs text-[var(--vy-text-dim)]">開いて内容を表示</p>}
    </button>
    {opened === key && currentAccount === accountId && accountId && albumId && <AlbumModal accountId={accountId} chatId={message.chatId} initialAlbumId={albumId} onClose={() => setOpened(null)} />}
  </div>;
}
