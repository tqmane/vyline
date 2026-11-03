import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useFriendActions } from "@/hooks/useProfileController";
import { ActionDialog } from "./action-dialog";
import { MediaLightbox } from "./media-lightbox";
import { Avatar } from "./vy-ui";
import { lineAvatarUrl } from "@/utils/lineMedia";
import { hasBetaFeatureConsent } from "./beta-consent";
import { maskPrivacyText, privacyPresentation } from "@/lib/settingsPreferences";

/** Browsing never adds a friend or creates a local conversation. */
export function MidSearchProfile({ mid, onClose }: { mid: string; onClose: () => void }) {
  const accountId = useStore(s => s.accountId);
  const settings = useStore(s => s.settings);
  const privacy = privacyPresentation(settings);
  const enabled = settings.betaMidSearch;
  const allowed = enabled && hasBetaFeatureConsent("mid-user-search");
  const friend = useFriendActions(mid, allowed);
  const [initialAccount] = useState(accountId);
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => { if (privacy.avatars) setZoom(null); }, [privacy.avatars]);
  useEffect(() => { if (accountId !== initialAccount || !allowed) onClose(); }, [accountId, initialAccount, allowed, onClose]);
  const profile = friend.contact?.profile;
  return <ActionDialog title="MIDのプロフィール（閲覧）" onClose={onClose}>
    {!accountId && <p role="status">ログイン後に検索できます。</p>}
    {friend.loading && <p role="status">プロフィールを読み込み中…</p>}
    {friend.error && <div role="alert"><p>{friend.error}</p><button type="button" onClick={friend.retry}>再試行</button></div>}
    {profile && <div className="space-y-3">
      {!privacy.avatars && settings.showBackground && profile.backgroundUrl && <button type="button" aria-label="背景を拡大" onClick={() => setZoom(profile.backgroundUrl!)}><img src={lineAvatarUrl(profile.backgroundUrl)} alt="背景" className="max-h-40 w-full rounded-xl object-cover" /></button>}
      <button type="button" aria-label="アイコンを拡大" disabled={privacy.avatars || !profile.thumbnailUrl} onClick={() => setZoom(profile.thumbnailUrl!)}><Avatar size={80} glyph={privacy.avatars ? "•" : (profile.displayName || "?").charAt(0)} color="#7c5cff" imageUrl={privacy.avatars ? undefined : profile.thumbnailUrl} /></button>
      <h2 className="text-lg font-semibold">{maskPrivacyText(privacy.names ? "ユーザー" : profile.displayName || "名前を取得できません", settings)}</h2>
      <p className="break-all text-xs">{maskPrivacyText(mid, settings)}</p>
      <p className="whitespace-pre-wrap">{maskPrivacyText(profile.statusMessage ?? "", settings)}</p>
      <p>{friend.contact?.isFriend ? "友だち追加済み" : "友だちではありません"}{friend.contact?.isBlocked ? "・ブロック中" : ""}</p>
      {friend.contact?.blockedStale && <p role="status">ブロック情報は古い可能性があります。</p>}
      <button type="button" onClick={() => { useStore.getState().openDirectChatWith(mid); onClose(); }} className="w-full rounded-xl border p-2">トークを開く</button>
      <button type="button" disabled={friend.busy || (!friend.contact?.isFriend && (friend.contact?.isBlocked || friend.contact?.blockedStale))} onClick={() => void friend.changeFriend()} className="w-full rounded-xl border p-2 disabled:opacity-50">{friend.busy ? "処理中…" : friend.contact?.isFriend ? "友だちから削除" : "友だちに追加"}</button>
    </div>}
    {zoom && !privacy.avatars && <MediaLightbox src={lineAvatarUrl(zoom) ?? ""} alt="プロフィール画像" onClose={() => setZoom(null)} />}
  </ActionDialog>;
}
