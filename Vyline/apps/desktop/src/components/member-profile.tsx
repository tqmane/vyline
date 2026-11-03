import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useStore,
  memberDisplayName,
  memberGlyph,
  displayName,
  commonGroupsWith,
  type Chat,
} from "@/lib/store";
import { api } from "@/api/client";
import { looksLikeMid } from "@/lib/mappers";
import { canDirectCall } from "@/utils/callAllowlist";
import { Avatar } from "@/components/vy-ui";
import { OfficialBadge } from "@/components/official-badge";
import { IconClose, IconChat, IconPhone, IconVideo, IconUsers } from "@/components/icons";
import { useFriendActions } from "@/hooks/useProfileController";
import { maskSocialUrls, mergeCommonGroups } from "@/lib/socialPresentation";
import { privacyPresentation } from "@/lib/settingsPreferences";
import { captureAccountContext } from "@/lib/accountContext";
import { MediaLightbox } from "./media-lightbox";
import { lineAvatarUrl } from "@/utils/lineMedia";

type RichInfo = {
  statusMessage?: string;
  backgroundUrl?: string;
  userType?: number;
};

export function MemberProfilePopover({ chat }: { chat: Chat }) {
  const memberProfile = useStore((s) => s.memberProfile);
  const close = useStore((s) => s.closeMemberProfile);
  const openDirectChatWith = useStore((s) => s.openDirectChatWith);
  const openChat = useStore((s) => s.openChat);
  const chats = useStore((s) => s.chats);
  const settings = useStore(s => s.settings);
  const privacy = privacyPresentation(settings);
  const streamerMode = privacy.names;
  const accountId = useStore((s) => s.accountId);
  const blockedMids = useStore((s) => s.blockedMids);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [apiCommonGroups, setApiCommonGroups] = useState<Chat[] | null>(null);
  const [rich, setRich] = useState<RichInfo>({});
  const member = chat.members?.find((m) => m.id === memberProfile?.memberId);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const friendship = useFriendActions(member?.id ?? "", !streamerMode && member?.id !== useStore.getState().self.mid);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!member || !dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The native top layer also moves focus out of the Compose iframe.
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && previousFocus?.isConnected)
          previousFocus.focus({ preventScroll: true });
      });
    };
  }, [chat.id, member?.id]);

  const memberId = member?.id;
  const commonGroups = useMemo(
    () => mergeCommonGroups(member ? commonGroupsWith(chats, member.id, chat.id) : [], (apiCommonGroups ?? []).map(group => ({ chatMid: group.id, name: group.name, thumbnailUrl: group.avatarUrl })), chats, chat.id),
    [apiCommonGroups, chats, member, chat.id],
  );

  const backgroundUrl = rich.backgroundUrl;
  const showBackground = Boolean(!privacy.avatars && settings.showBackground && backgroundUrl);

  useEffect(() => {
    setApiCommonGroups(null);
    setRich({});
    setZoomImage(null); setMsg(null); setBusy(false);
    if (!accountId || !memberId || (streamerMode && privacy.avatars)) return;
    let cancelled = false;
    const context = captureAccountContext(useStore);
    void api.line
      .contactProfile(accountId, memberId)
      .then((res) => {
        if (cancelled || !context.isCurrent() || !res.ok || !res.profile) return;
        setRich({
          statusMessage: res.profile.statusMessage,
          backgroundUrl: res.profile.backgroundUrl,
          userType: res.profile.userType,
        });
        useStore.setState((st) => ({
          chats: st.chats.map((c) =>
            c.id === chat.id
              ? {
                  ...c,
                  members: c.members?.map((m) =>
                    m.id === member.id
                      ? {
                          ...m,
                          avatarUrl: res.profile?.thumbnailUrl || m.avatarUrl,
                          name:
                            res.profile?.displayName && !looksLikeMid(res.profile.displayName)
                              ? res.profile.displayName
                              : m.name,
                        }
                      : m,
                  ),
                }
              : c,
          ),
        }));
      })
      .catch(() => undefined);
    void api.line
      .commonGroups(accountId, memberId, chat.id)
      .then((res) => {
        if (cancelled || !context.isCurrent() || !res.ok || !res.groups) return;
        const byId = new Map(useStore.getState().chats.map((c) => [c.id, c]));
        setApiCommonGroups(
          res.groups.map((g) => {
            const local = byId.get(g.chatMid);
            const name = local?.name && !looksLikeMid(local.name) ? local.name : g.name;
            const initial = (name || "G").trim().charAt(0).toUpperCase();
            return {
              id: g.chatMid,
              type: "group" as const,
              name,
              avatar: looksLikeMid(initial) ? "G" : initial,
              avatarUrl: g.thumbnailUrl || local?.avatarUrl,
              color: local?.color ?? "#7c5cff",
              status: "グループ",
              unread: 0,
            } satisfies Chat;
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      context.dispose();
    };
  }, [accountId, memberId, chat.id, streamerMode, privacy.avatars]);

  if (!member || typeof document === "undefined") return null;

  const name = maskSocialUrls(memberDisplayName(member.name, streamerMode), privacy.urls);
  const glyph = memberGlyph(member.avatar, streamerMode || privacy.avatars);
  const isBlocked = blockedMids.includes(member.id);
  const isOfficial = chat.isOfficial || rich.userType === 2;

  // 誤タップで実際に発信してしまわないよう必ず確認する。
  const placeCall = (kind: "voice" | "video") => {
    if (!canDirectCall(member.id)) return;
    const label = kind === "video" ? "ビデオ通話" : "音声通話";
    if (!window.confirm(`${name} に${label}を発信しますか？`)) return;
    close();
    useStore.getState().requestCall(member.id, kind);
  };

  const blockMember = async () => {
    if (!accountId || busy) return;
    const isBlocked = useStore.getState().blockedMids.includes(member.id);
    if (!isBlocked && !window.confirm(`「${name}」をブロックしますか？`)) return;
    setBusy(true);
    setMsg(null);
    const context = captureAccountContext(useStore);
    try {
      const res = isBlocked
        ? await api.line.unblockContact(accountId, member.id)
        : await api.line.blockContact(accountId, member.id);
      if (!context.isCurrent()) return;
      if (!res.ok) {
        setMsg(res.error ?? (isBlocked ? "ブロック解除に失敗しました" : "ブロックに失敗しました"));
        return;
      }
      useStore.setState((st) => ({
        blockedMids: isBlocked
          ? st.blockedMids.filter((m) => m !== member.id)
          : st.blockedMids.includes(member.id)
            ? st.blockedMids
            : [...st.blockedMids, member.id],
      }));
      setMsg(isBlocked ? "ブロックを解除しました" : "ブロックしました");
      close();
    } catch (err) {
      if (context.isCurrent()) setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (context.isCurrent()) setBusy(false);
      context.dispose();
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="vy-fade-in vy-viewport-overlay z-[80] m-0 w-full max-w-none max-h-none overflow-y-auto border-0 bg-black/50 px-4 py-0 text-[var(--vy-text)] backdrop:bg-transparent"
      onClick={close}
      onCancel={(event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        close();
      }}
      aria-modal="true"
      aria-label={`${name} のプロフィール`}
    >
      <div className="flex min-h-full items-center justify-center py-4">
        <div
          className="vy-scale-in max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto overscroll-contain rounded-3xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-2xl vy-scroll"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="relative flex flex-col items-center px-6 pb-5 pt-8"
            style={
              showBackground
                ? {
                    backgroundImage: `linear-gradient(180deg, color-mix(in oklab, black 10%, transparent), color-mix(in oklab, black 24%, transparent)), url(${backgroundUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : { background: `color-mix(in oklab, ${member.color} 18%, var(--vy-surface))` }
            }
          >
            <button
              type="button"
              onClick={close}
              aria-label="閉じる"
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-black/10 hover:text-[var(--vy-text)]"
            >
              <IconClose size={16} />
            </button>
            {showBackground && <button type="button" aria-label="背景を拡大" onClick={() => setZoomImage(backgroundUrl!)} className="mb-2 rounded-lg bg-black/30 px-3 py-1 text-xs text-white">背景を拡大</button>}
            <button type="button" aria-label="アイコンを拡大" disabled={privacy.avatars || !member.avatarUrl} onClick={() => setZoomImage(member.avatarUrl!)} className="rounded-full">
            <Avatar
              glyph={glyph}
              color={member.color}
              size={92}
              imageUrl={privacy.avatars ? undefined : member.avatarUrl}
            />
            </button>
            <div className="mt-3 flex items-center gap-1.5">
              <h2 className="text-lg font-bold">{name}</h2>
              {!streamerMode && isOfficial && <OfficialBadge className="ml-0" />}
            </div>
            {!streamerMode && (
              <p className="mt-1 font-mono text-xs break-all text-[var(--vy-text-dim)] select-all">
                {member.id}
              </p>
            )}
            <p className="mt-0.5 text-xs text-[var(--vy-text-dim)]">
              {streamerMode ? "配信者モードで非表示" : `${maskSocialUrls(chat.name, privacy.urls)} のメンバー`}
            </p>
            {!streamerMode && (rich.statusMessage || isOfficial || isBlocked) && (
              <div className="mt-4 w-full space-y-2 rounded-2xl border border-white/10 bg-black/10 p-3 text-left text-white backdrop-blur-sm">
                {rich.statusMessage && <TinyInfo label="ステメ" value={maskSocialUrls(rich.statusMessage, privacy.urls)} />}
                {isOfficial && (
                  <span className="inline-flex rounded-full bg-white/15 px-2.5 py-1 text-[0.65rem] font-medium text-white">
                    公式アカウント
                  </span>
                )}
                {isBlocked && <TinyInfo label="状態" value="アカウントをブロックしています" />}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 p-4">
            <MiniAction
              icon={<IconChat size={18} />}
              label="トーク"
              onClick={() => openDirectChatWith(member.id)}
            />
            <MiniAction
              icon={<IconPhone size={18} />}
              label="通話"
              disabled={!canDirectCall(member.id)}
              onClick={() => placeCall("voice")}
            />
            <MiniAction
              icon={<IconVideo size={18} />}
              label="ビデオ"
              disabled={!canDirectCall(member.id)}
              onClick={() => placeCall("video")}
            />
          </div>

          {!streamerMode && (
            <div className="border-t border-[var(--vy-border)] px-4 pb-3">
              {friendship.contact && <button type="button" disabled={friendship.busy || (!friendship.contact.isFriend && (isBlocked || friendship.contact.isBlocked || friendship.contact.blockedStale))} onClick={() => void friendship.changeFriend()} className="my-2 w-full rounded-xl border border-[var(--vy-border)] p-2 text-sm disabled:opacity-50">{friendship.busy ? "処理中…" : friendship.contact.isFriend ? "友だちから削除" : "友だちに追加"}</button>}
              {friendship.error && <p role="alert" className="my-2 text-xs">{friendship.error}<button type="button" onClick={friendship.retry} className="ml-2 underline">再試行</button></p>}
              {friendship.contact?.blockedStale && <p role="status" className="my-2 text-xs">ブロック情報は古い可能性があります。</p>}
              <button
                type="button"
                disabled={!accountId || busy}
                aria-describedby={!accountId ? "member-profile-block-requirement" : undefined}
                onClick={() => void blockMember()}
                className="w-full rounded-xl border border-[var(--vy-border)] px-3 py-2.5 text-sm font-medium text-[var(--vy-danger)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-danger)_12%,transparent)] disabled:opacity-50"
              >
                {busy ? "処理中…" : isBlocked ? "ブロックを解除" : "ブロック"}
              </button>
              {!accountId && (
                <p
                  id="member-profile-block-requirement"
                  className="mt-2 text-xs text-[var(--vy-text-dim)]"
                >
                  ログイン後にブロック操作を利用できます。
                </p>
              )}
              {msg && <p className="mt-2 text-xs text-[var(--vy-text-dim)]">{msg}</p>}
            </div>
          )}

          {!streamerMode && (
            <div className="border-t border-[var(--vy-border)] px-4 pb-4 pt-2">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--vy-text-dim)]">
                <IconUsers size={14} />
                共通のグループ
                {commonGroups.length > 0 && (
                  <span className="rounded-full bg-[var(--vy-surface-2)] px-2 py-0.5 text-[0.65rem]">
                    {commonGroups.length}
                  </span>
                )}
              </div>
              {commonGroups.length === 0 ? (
                <p className="text-xs leading-relaxed text-[var(--vy-text-dim)]">
                  履歴を読み込んだグループの中に共通グループは見つかりませんでした
                </p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto vy-scroll">
                  {commonGroups.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          openChat(g.id);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--vy-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
                      >
                        <Avatar glyph={privacy.avatars ? "•" : g.avatar} color={g.color} size={32} imageUrl={privacy.avatars ? undefined : g.avatarUrl} />
                        <span className="truncate text-sm font-medium">
                          {maskSocialUrls(displayName(g, false), privacy.urls)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      {zoomImage && !privacy.avatars && <MediaLightbox src={lineAvatarUrl(zoomImage) ?? ""} alt="プロフィール画像" onClose={() => setZoomImage(null)} />}
    </dialog>,
    document.body,
  );
}

function TinyInfo({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-xs leading-relaxed">
      <span className="text-white/70">{label} · </span>
      <span>{value}</span>
    </p>
  );
}

function MiniAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 rounded-xl bg-[var(--vy-surface-2)] py-2.5 text-xs font-medium transition-colors hover:bg-[color-mix(in_oklab,var(--vy-accent)_16%,var(--vy-surface-2))] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span style={{ color: "var(--vy-accent)" }}>{icon}</span>
      {label}
    </button>
  );
}
