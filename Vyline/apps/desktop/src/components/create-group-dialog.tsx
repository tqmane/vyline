import { requestControllerConfirm } from "@/ui/controller-dialog";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import { useStore, displayName } from "@/lib/store";
import { Avatar } from "@/components/vy-ui";
import { IconClose, IconUsers } from "@/components/icons";
import { useControllerPresentation } from "@/ui/native-controller-surface";
import { socialApi } from "@/api/social";
import { captureAccountContext } from "@/lib/accountContext";
import { isUserMid } from "@/lib/socialPresentation";

export function CreateGroupDialog({ onClose }: { onClose: () => void }) {
  const accountId = useStore((s) => s.accountId);
  const chats = useStore((s) => s.chats);
  const streamerMode = useStore((s) => s.settings.streamerMode);
  const openChat = useStore((s) => s.openChat);
  const refreshChats = useStore((s) => s.refreshChats);

  const blockedMids = useStore(s => s.blockedMids);
  const friends = useMemo(() => chats.filter((c) => c.type === "friend" && !c.hidden && !c.left && !c.isSelf && isUserMid(c.id) && !blockedMids.includes(c.id)), [chats, blockedMids]);

  const [name, setName] = useState("");
  const [mode, setMode] = useState<"group" | "room">("group");
  const pending = useRef(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controller = useControllerPresentation();

  useEffect(() => {
    setName(""); setSelected(new Set()); setQuery(""); setMsg(null); setBusy(false); setBanned(false); pending.current = false;
    if (!accountId) return;
    let cancelled = false;
    void api.line.featureLocks(accountId).then((res) => {
      if (!cancelled && res.ok && res.locks?.createGroupBanned) setBanned(true);
    }).catch(() => { if (!cancelled) setMsg("作成制限を確認できませんでした。作成時に再確認します。"); });
    return () => { cancelled = true; };
  }, [accountId]);

  const handleUnlock = async () => {
    if (!accountId || unlocking) return;
    if (
      !await requestControllerConfirm(
        "グループ作成の禁止を解除しますか？\n（ABUSE_BLOCK のリスクがあるため自己責任でお願いします）",
      )
    )
      return;
    setUnlocking(true);
    try {
      const res = await api.line.clearCreateGroupBan(accountId);
      if (res.ok && !res.locks?.createGroupBanned) {
        setBanned(false);
        setMsg("グループ作成の禁止を解除しました");
      } else {
        setMsg("解除に失敗しました");
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setUnlocking(false);
    }
  };

  useLayoutEffect(() => {
    if (controller) return;
    const dialog = dialogRef.current!;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && previousFocus?.isConnected)
          previousFocus.focus({ preventScroll: true });
      });
    };
  }, [controller]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => displayName(f, streamerMode).toLowerCase().includes(q));
  }, [friends, query, streamerMode]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    if (!accountId || banned || pending.current) return;
    const mids = [...selected].filter(mid => friends.some(friend => friend.id === mid));
    if (mids.length === 0) {
      setMsg("メンバーを1人以上選んでください");
      return;
    }
    pending.current = true;
    setBusy(true);
    setMsg(null);
    const context = captureAccountContext(useStore);
    try {
      if (!await requestControllerConfirm(mode === "room" ? `選択した${mids.length}人を招待確認なしで複数人トークへ追加しますか？` : `選択した${mids.length}人を新しいグループへ招待しますか？`, { cancelFirst: true })) return;
      if (!context.isCurrent()) return;
      const res = await socialApi.createChat(accountId, mode === "group" ? name.trim() || "グループ" : "", mids, mode);
      if (!context.isCurrent()) return;
      await refreshChats();
      if (!context.isCurrent()) return;
      openChat(res.chat.chatMid);
      onClose();
    } catch (err) {
      if (!context.isCurrent()) return;
      const text = err instanceof Error ? err.message : String(err);
      if (text.includes("CREATE_GROUP_BANNED") || text.includes("ABUSE_BLOCK")) {
        setBanned(true);
        setMsg("グループ作成は永久に無効化されています（ABUSE_BLOCK / BAN 防止）");
      } else {
        setMsg(text);
      }
    } finally {
      if (context.isCurrent()) { setBusy(false); pending.current = false; }
      context.dispose();
    }
  };

  return (
    <dialog
      open={controller || undefined}
      ref={dialogRef}
      className="vy-fade-in vy-viewport-overlay z-[70] m-0 flex w-full max-w-none max-h-none items-end justify-center border-0 bg-black/50 p-4 text-[var(--vy-text)] backdrop:bg-transparent sm:items-center"
      aria-modal="true"
      aria-label="グループ・複数人トークを作成"
      onClick={onClose}
      onCancel={(event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="vy-scale-in flex max-h-[min(640px,calc(var(--vy-app-height,100dvh)-2rem))] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--vy-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <IconUsers size={18} style={{ color: "var(--vy-accent)" }} />
            <h2 className="text-sm font-semibold">{mode === "room" ? "複数人トークを作成" : "グループを作成"}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)]"
          >
            <IconClose size={16} />
          </button>
        </div>

        {banned ? (
          <div className="space-y-2 p-5">
            <p className="text-sm font-medium text-[var(--vy-danger)]">
              グループ作成は利用できません
            </p>
            <p className="text-xs leading-relaxed text-[var(--vy-text-dim)]">
              LINE から ABUSE_BLOCK が返ったため、アカウント BAN
              を避ける目的でグループ作成を無効化しています。
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-[var(--vy-accent-contrast)]"
                style={{ background: "var(--vy-accent)" }}
              >
                閉じる
              </button>
              <button
                type="button"
                disabled={unlocking}
                onClick={() => void handleUnlock()}
                className="flex-1 rounded-xl border border-[var(--vy-danger)] py-2.5 text-sm font-medium text-[var(--vy-danger)] transition-colors hover:bg-[color-mix(in_oklab,var(--vy-danger)_12%,transparent)] disabled:opacity-50"
              >
                {unlocking ? "解除中…" : "解除する (自己責任)"}
              </button>
            </div>
            {msg && <p className="text-xs text-[var(--vy-text-dim)]">{msg}</p>}
          </div>
        ) : (
          <>
            <div className="space-y-3 border-b border-[var(--vy-border)] px-4 py-3">
              <fieldset disabled={busy} className="space-y-2">
                <legend className="mb-1 text-xs">作成する形式</legend>
                <label className="flex gap-2 text-sm"><input type="radio" name="social-create-mode" value="group" checked={mode === "group"} onChange={() => setMode("group")} />グループ（招待して参加を待つ）</label>
                <label className="flex gap-2 text-sm"><input type="radio" name="social-create-mode" value="room" checked={mode === "room"} onChange={() => setMode("room")} />複数人トーク（招待確認なしで追加）</label>
              </fieldset>
              <p className="text-xs text-[var(--vy-text-dim)]">{mode === "room" ? "選択した友だちがすぐにトークへ追加されます。" : "選択した友だちへグループへの招待を送ります。"}</p>
              {mode === "group" && <input
                value={name}
                maxLength={100}
                disabled={busy}
                aria-label="グループ名"
                onChange={(e) => setName(e.target.value)}
                placeholder="グループ名（任意）"
                className="w-full rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
              />}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="友だちを検索"
                className="w-full rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
              />
              <p className="text-[0.7rem] text-[var(--vy-text-dim)]">選択中 {selected.size} 人</p>
            </div>

            <div className="vy-scroll min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-[var(--vy-text-dim)]">
                  追加できる友だちがありません
                </p>
              ) : (
                filtered.map((f) => {
                  const on = selected.has(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={busy}
                      aria-pressed={on}
                      onClick={() => toggle(f.id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--vy-surface-2)]"
                    >
                      <Avatar
                        glyph={streamerMode ? "•" : f.avatar}
                        color={f.color}
                        size={40}
                        imageUrl={streamerMode ? undefined : f.avatarUrl}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {displayName(f, streamerMode)}
                      </span>
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-full border text-[0.65rem]"
                        style={
                          on
                            ? {
                                background: "var(--vy-accent)",
                                borderColor: "var(--vy-accent)",
                                color: "var(--vy-accent-contrast)",
                              }
                            : { borderColor: "var(--vy-border)" }
                        }
                      >
                        {on ? "✓" : ""}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="border-t border-[var(--vy-border)] p-4">
              {msg && <p className="mb-2 text-xs text-[var(--vy-danger)]">{msg}</p>}
              {!accountId && (
                <p
                  id="create-group-account-required"
                  className="mb-2 text-xs text-[var(--vy-text-dim)]"
                >
                  ログイン後にグループを作成できます。
                </p>
              )}
              <button
                type="button"
                disabled={!accountId || busy || selected.size === 0}
                aria-describedby={!accountId ? "create-group-account-required" : undefined}
                onClick={() => void create()}
                className="w-full rounded-xl py-2.5 text-sm font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-40"
                style={{ background: "var(--vy-accent)" }}
              >
                {busy ? "作成中…" : mode === "room" ? "複数人トークを作成" : "グループを作成"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
