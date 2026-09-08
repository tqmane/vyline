import { useProfileController } from "@/hooks/useProfileController";
import { useState } from "react";
import { displayName, type Chat } from "@/lib/store";
import { api } from "@/api/client";
import { Avatar } from "@/components/vy-ui";
import { PremiumBadge } from "@/components/premium-badge";
import { OfficialBadge } from "@/components/official-badge";
import {
  IconClose,
  IconChat,
  IconPhone,
  IconVideo,
  IconEdit,
  IconLogout,
  IconUsers,
  IconCheck,
  IconDownload,
  IconMemo,
} from "@/components/icons";
import { looksLikeMid } from "@/lib/mappers";
import { canStartCall } from "@/utils/callAllowlist";
import { AgentIActionDialog } from "@/components/agent-i-action-dialog";

export function ProfileDrawer({ chat }: { chat: Chat }) {
  const { setProfileDrawer, openChat, openMemberProfile, streamerMode, settings, accountId, selfPremium, editing, setEditing, nameInput, setNameInput, rich, busy, actionMsg, setActionMsg, membersLoading, isBlocked, verifyBusy, verifyMsg, commonGroups, agentPrompt, setAgentPrompt, name, backgroundUrl, showBackground, handleTalk, placeCall, saveName, leaveOrBlock, conversationText, exportConversation, verifyBlockStatus } = useProfileController(chat);
  return (
    <>
      <div
        className="vy-fade-in vy-viewport-overlay z-30 bg-black/40 xl:hidden"
        onClick={() => setProfileDrawer(false)}
        aria-hidden
      />
      <aside className="vy-drawer-in vy-profile-drawer z-40 flex w-[min(360px,88vw)] flex-col border-l border-[var(--vy-border)] bg-[var(--vy-surface)] xl:z-0 xl:w-[340px]">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold">プロフィール</span>
          <button
            type="button"
            onClick={() => setProfileDrawer(false)}
            aria-label="閉じる"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
          >
            <IconClose size={18} />
          </button>
        </div>

        <div className="vy-scroll flex-1 overflow-y-auto px-5 pb-6">
          <div className="overflow-hidden rounded-2xl border border-[var(--vy-border)]">
            <div
              className="h-28 bg-[color-mix(in_oklab,var(--vy-accent)_18%,var(--vy-surface-2))]"
              style={
                showBackground
                  ? {
                      backgroundImage: `linear-gradient(180deg, color-mix(in oklab, black 8%, transparent), color-mix(in oklab, black 20%, transparent)), url(${backgroundUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : { background: `color-mix(in oklab, ${chat.color} 22%, var(--vy-surface-2))` }
              }
            />
            <div className="-mt-12 flex flex-col items-center px-4 pb-4 text-center">
              <Avatar
                glyph={streamerMode ? "•" : chat.avatar}
                color={chat.color}
                size={88}
                online={chat.online}
                imageUrl={streamerMode ? undefined : chat.avatarUrl}
                icon={!streamerMode && chat.isSelf ? <IconMemo size={44} /> : undefined}
              />
              {editing ? (
                <div className="mt-3 flex w-full items-center gap-2">
                  <input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-center text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
                    aria-label={chat.type === "friend" ? "友だち表示名" : "表示名（ローカル）"}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveName()}
                    aria-label="保存"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--vy-accent-contrast)] disabled:opacity-50"
                    style={{ background: "var(--vy-accent)" }}
                  >
                    <IconCheck size={18} />
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <h2 className="text-xl font-bold">{name}</h2>
                  {!streamerMode && chat.isOfficial && <OfficialBadge />}
                  {chat.isSelf && selfPremium && <PremiumBadge size={14} compact />}
                  {!streamerMode && !chat.isSelf && (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      aria-label="表示名を変更"
                      className="text-[var(--vy-text-dim)] transition-colors hover:text-[var(--vy-accent)]"
                    >
                      <IconEdit size={16} />
                    </button>
                  )}
                </div>
              )}
              {chat.left && (
                <span className="mt-2 rounded-full bg-[color-mix(in_oklab,var(--vy-danger)_18%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--vy-danger)]">
                  {chat.type === "friend" ? "アカウント削除済み" : "退出済み"}
                </span>
              )}
              {isBlocked && (
                <span className="mt-2 rounded-full bg-[color-mix(in_oklab,var(--vy-danger)_18%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--vy-danger)]">
                  ブロック中
                </span>
              )}
              {!streamerMode && (
                <p className="mt-1 font-mono text-[0.65rem] break-all text-[var(--vy-text-dim)] select-all">
                  {chat.id}
                </p>
              )}
              {!streamerMode &&
                settings.showStatusMessage &&
                (chat.statusMessage ?? rich.statusMessage) && (
                  <p className="mt-1 text-sm text-[var(--vy-text-dim)]">
                    {chat.statusMessage ?? rich.statusMessage}
                  </p>
                )}
            </div>
          </div>

          {!streamerMode && (chat.isOfficial || rich.userType === 2) && (
            <div className="mt-4">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--vy-accent)_16%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--vy-accent)]">
                <OfficialBadge className="ml-0" />
                公式アカウント
              </span>
            </div>
          )}

          {!streamerMode && (chat.left || isBlocked) && (
            <div className="mt-4 space-y-1 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm">
              {chat.left && <p className="text-[var(--vy-danger)]">アカウントは削除済みです</p>}
              {isBlocked && (
                <p className="text-[var(--vy-danger)]">アカウントをブロックしています</p>
              )}
            </div>
          )}

          <div className="mt-6 grid grid-cols-3 gap-2">
            <Action icon={<IconChat size={20} />} label="トーク" onClick={handleTalk} />
            <Action
              icon={<IconPhone size={20} />}
              label="音声通話"
              disabled={!canStartCall(chat.id, "voice")}
              onClick={() => placeCall("voice")}
            />
            <Action
              icon={<IconVideo size={20} />}
              label="ビデオ通話"
              disabled={!canStartCall(chat.id, "video")}
              onClick={() => placeCall("video")}
            />
            <Action icon={<IconDownload size={20} />} label="トーク保存" onClick={() => void exportConversation()} />
          </div>

          {!streamerMode && settings.betaAgentI && chat.type === "friend" && !chat.isSelf && (
            <button
              type="button"
              disabled={!conversationText}
              onClick={() =>
                setAgentPrompt(
                  `次の「${name}」とのこれまでの会話を日本語で5行以内に要約してください。重要な決定、約束、TODOを含めてください。\n\n${conversationText}`,
                )
              }
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--vy-border)] px-3 py-2.5 text-sm disabled:opacity-50"
            >
              AIでこの人との会話を要約
            </button>
          )}

          {!streamerMode &&
            settings.betaBlockCheckManual &&
            chat.type === "friend" &&
            !chat.isOfficial && (
              <div className="mt-3">
                <button
                  type="button"
                  disabled={verifyBusy}
                  onClick={() => void verifyBlockStatus()}
                  className="w-full rounded-xl border border-[var(--vy-border)] px-3 py-2 text-sm transition-colors hover:bg-[var(--vy-surface-2)] disabled:opacity-50"
                >
                  {verifyBusy ? "ブロック状態を確認中…" : "ブロック状態を確認"}
                </button>
                {verifyMsg && <p className="mt-1 text-xs text-[var(--vy-text-dim)]">{verifyMsg}</p>}
              </div>
            )}

          {chat.type === "friend" && !streamerMode && !chat.isSelf && commonGroups.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--vy-text-dim)]">
                <IconUsers size={15} />
                共通のグループ ({commonGroups.length})
              </div>
              <div className="overflow-hidden rounded-xl border border-[var(--vy-border)]">
                {commonGroups.map((g, i) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setProfileDrawer(false);
                      openChat(g.id);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--vy-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
                    style={i > 0 ? { borderTop: "1px solid var(--vy-border)" } : undefined}
                  >
                    <Avatar glyph={g.avatar} color={g.color} size={36} imageUrl={g.avatarUrl} />
                    <span className="truncate text-sm font-medium">{displayName(g, false)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {chat.type === "group" && chat.members && !chat.left && (
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--vy-text-dim)]">
                <IconUsers size={15} />
                メンバー {chat.members.length}人
              </div>
              <div className="overflow-hidden rounded-xl border border-[var(--vy-border)]">
                {chat.members.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => openMemberProfile(chat.id, m.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--vy-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
                    style={i > 0 ? { borderTop: "1px solid var(--vy-border)" } : undefined}
                  >
                    <Avatar
                      glyph={streamerMode ? "•" : m.avatar}
                      color={m.color}
                      size={36}
                      imageUrl={streamerMode ? undefined : m.avatarUrl}
                    />
                    <span className="truncate text-sm font-medium">
                      {streamerMode
                        ? "メンバー"
                        : looksLikeMid(m.name)
                          ? membersLoading
                            ? "取得中…"
                            : `${m.name.slice(0, 12)}…`
                          : m.name}
                    </span>
                  </button>
                ))}
              </div>
              {!streamerMode && accountId && (
                <InviteToGroupRow
                  chatMid={chat.id}
                  accountId={accountId}
                  onDone={(msg) => setActionMsg(msg)}
                />
              )}
            </div>
          )}

          {!streamerMode && !chat.isSelf && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void leaveOrBlock()}
              className="mt-6 flex w-full items-center gap-3 rounded-xl border border-[var(--vy-border)] px-4 py-3 text-sm font-medium text-[var(--vy-danger)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-danger)_12%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--vy-danger)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconLogout size={18} />
              {chat.type === "group"
                ? chat.left
                  ? busy
                    ? "削除中…"
                    : "一覧から削除"
                  : busy
                    ? "退出中…"
                    : "グループを退出"
                : isBlocked
                  ? busy
                    ? "解除中…"
                    : "ブロックを解除"
                  : busy
                    ? "処理中…"
                    : "ブロック"}
            </button>
          )}
          {actionMsg && <p className="mt-2 text-xs text-[var(--vy-text-dim)]">{actionMsg}</p>}
        </div>
      </aside>
      {agentPrompt && (
        <AgentIActionDialog
          title={`${name}との会話の要約`}
          prompt={agentPrompt}
          onClose={() => setAgentPrompt(null)}
        />
      )}
    </>
  );
}

function Action({
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
      className="flex flex-col items-center gap-1.5 rounded-xl bg-[var(--vy-surface-2)] py-3 text-xs font-medium transition-colors hover:bg-[color-mix(in_oklab,var(--vy-accent)_16%,var(--vy-surface-2))] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span style={{ color: "var(--vy-accent)" }}>{icon}</span>
      {label}
    </button>
  );
}

function InviteToGroupRow({
  chatMid,
  accountId,
  onDone,
}: {
  chatMid: string;
  accountId: string;
  onDone: (msg: string) => void;
}) {
  const { open, setOpen, mids, setMids, busy, invite } = useGroupInvitation(chatMid, accountId, onDone);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-[var(--vy-accent)]"
      >
        {open ? "招待を閉じる" : "メンバーを招待"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-[var(--vy-border)] p-3">
          <textarea
            value={mids}
            onChange={(e) => setMids(e.target.value)}
            placeholder="招待する mid（改行またはカンマ区切り）"
            rows={3}
            className="w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void invite()}
            className="w-full rounded-lg py-2 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
            style={{ background: "var(--vy-accent)" }}
          >
            {busy ? "招待中…" : "招待する"}
          </button>
        </div>
      )}
    </div>
  );
}

export function useGroupInvitation(chatMid: string, accountId: string | null, onDone: (message: string) => void) {
  const [open, setOpen] = useState(false);
  const [mids, setMids] = useState("");
  const [busy, setBusy] = useState(false);

  const invite = async () => {
    if (!accountId) return;
    const list = mids
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("u"));
    if (list.length === 0) {
      onDone("招待する mid（u…）を入力してください");
      return;
    }
    setBusy(true);
    try {
      const res = await api.line.inviteToGroup(accountId, chatMid, list);
      if (!res.ok) {
        onDone(res.error || "招待に失敗しました");
        return;
      }
      onDone(`${list.length}人を招待しました`);
      setMids("");
      setOpen(false);
    } catch (e) {
      onDone(e instanceof Error ? e.message : "招待に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return { open, setOpen, mids, setMids, busy, invite };
}
