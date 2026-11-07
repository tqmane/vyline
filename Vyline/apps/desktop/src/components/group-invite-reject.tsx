import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { isUserMid } from "@/lib/socialPresentation";
import { maskPrivacyText, privacyPresentation } from "@/lib/settingsPreferences";
import { ActionDialog } from "./action-dialog";

type GroupInviteRejectProps = { accountId: string; chatId: string; onClose: () => void };

export function GroupInviteReject(props: GroupInviteRejectProps) {
  return <GroupInviteRejectSession key={JSON.stringify([props.accountId, props.chatId])} {...props} />;
}

function GroupInviteRejectSession({
  accountId,
  chatId,
  onClose,
}: GroupInviteRejectProps) {
  const settings = useStore((state) => state.settings);
  const privacy = privacyPresentation(settings);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<Array<{ mid: string; displayName: string }>>([]);
  const [query, setQuery] = useState("");
  const [midInput, setMidInput] = useState("");
  const [midError, setMidError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setNotice("");
    setQuery("");
    setMidInput("");
    setMidError("");
    void api.line
      .getGroupInviteReject(accountId, chatId)
      .then((result) => {
        if (cancelled || useStore.getState().accountId !== accountId) return;
        if (!result.ok || !result.rule || !result.friends)
          throw new Error(result.error || "友だちと設定を取得できませんでした");
        const users = new Map(result.friends.map((friend) => [friend.mid, friend]));
        for (const mid of result.rule.targetMids) {
          if (!users.has(mid)) users.set(mid, { mid, displayName: "MIDで指定" });
        }
        setEnabled(result.rule.enabled);
        setSelected(new Set(result.rule.targetMids));
        setCandidates([...users.values()]);
      })
      .catch((error) => {
        if (!cancelled) setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, chatId, retry]);
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return candidates
      .filter(
        (user) =>
          user.displayName.toLowerCase().includes(search) ||
          user.mid.toLowerCase().includes(search),
      )
      .sort((a, b) => Number(selected.has(b.mid)) - Number(selected.has(a.mid)));
  }, [candidates, query, selected]);
  function addMid() {
    if (loading || saving || error || useStore.getState().accountId !== accountId) return;
    const mid = midInput.trim().toLowerCase();
    if (!isUserMid(mid)) {
      setMidError("MIDは u に続く32文字（0〜9、a〜f）で入力してください");
      return;
    }
    if (mid === useStore.getState().self?.mid?.toLowerCase()) {
      setMidError("自分自身は招待拒否の対象にできません");
      return;
    }
    setCandidates((current) =>
      current.some((user) => user.mid === mid)
        ? current
        : [...current, { mid, displayName: "MIDで指定" }],
    );
    setSelected((current) => new Set([...current, mid]));
    setMidInput("");
    setMidError("");
    setQuery("");
    setNotice("");
  }
  async function save() {
    if (loading || saving || error || useStore.getState().accountId !== accountId) return;
    setSaving(true);
    setNotice("");
    try {
      const result = await api.line.saveGroupInviteReject(accountId, chatId, {
        enabled,
        targetMids: [...selected],
      });
      if (useStore.getState().accountId !== accountId) return;
      if (!result.ok) throw new Error(result.error || "保存できませんでした");
      setNotice(result.warning || "設定を保存しました");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <ActionDialog title="招待拒否" onClose={onClose}>
      <p className="mb-4 text-sm text-[var(--vy-text-dim)]">
        このグループで、選択したユーザーの招待を自動で取り消し、参加済みなら退会させます。友だち以外もMIDで指定できます。
      </p>
      {loading ? (
        <p role="status">友だちを読み込み中…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            再読み込み
          </button>
        </div>
      ) : (
        <>
          <label className="mb-4 flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            このグループで有効にする
          </label>
          <form
            className="mb-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addMid();
            }}
          >
            <input
              type={privacy.names ? "password" : "text"}
              aria-label="対象者のMID"
              aria-invalid={!!midError}
              placeholder="uから始まるMIDを入力"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              value={midInput}
              disabled={saving}
              onChange={(event) => {
                setMidInput(event.target.value);
                setMidError("");
              }}
              className="min-w-0 flex-1 rounded-lg bg-[var(--vy-surface-2)] p-3"
            />
            <button
              type="submit"
              disabled={saving || !midInput.trim()}
              className="min-h-11 shrink-0 rounded-lg border border-[var(--vy-border)] px-3 disabled:opacity-50"
            >
              MIDで追加
            </button>
          </form>
          {midError && (
            <p role="alert" className="mb-3 text-sm text-[var(--vy-danger)]">
              {midError}
            </p>
          )}
          <input
            type="search"
            aria-label="招待拒否の対象者を検索"
            placeholder="名前・MIDで検索"
            value={query}
            disabled={saving}
            onChange={(event) => setQuery(event.target.value)}
            className="mb-3 w-full rounded-lg bg-[var(--vy-surface-2)] p-3"
          />
          <p className="mb-2 text-xs text-[var(--vy-text-dim)]">
            候補 {candidates.length}人 · 選択 {selected.size}人（選択済みを上に表示）
          </p>
          <fieldset className="max-h-[min(18rem,35dvh)] min-w-0 space-y-2 overflow-y-auto overscroll-contain">
            <legend className="sr-only">招待拒否の対象者</legend>
            {visible.map((user) => {
              const displayName = privacy.names
                ? "ユーザー"
                : maskPrivacyText(user.displayName, settings);
              const displayMid = maskPrivacyText(user.mid, settings);
              return (
                <label
                  key={user.mid}
                  data-native-label={displayName}
                  data-native-description={displayMid}
                  className="flex min-h-11 items-center gap-3 rounded-lg bg-[var(--vy-surface-2)] p-3"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(user.mid)}
                    disabled={saving}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(user.mid)) next.delete(user.mid);
                        else next.add(user.mid);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <strong className="block break-words text-sm">{displayName}</strong>
                    <small className="block break-all text-xs text-[var(--vy-text-dim)]">
                      {displayMid}
                    </small>
                  </span>
                </label>
              );
            })}
            {visible.length === 0 && <p className="py-3 text-sm">該当するユーザーはいません</p>}
          </fieldset>
          <div data-native-strip="true" className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving || !selected.size}
              className="min-h-11 rounded-lg px-4"
              onClick={() => setSelected(new Set())}
            >
              選択をクリア
            </button>
            <button
              type="button"
              disabled={saving}
              className="min-h-11 rounded-lg bg-[var(--vy-accent)] px-4 text-[var(--vy-accent-contrast)]"
              onClick={() => void save()}
            >
              {saving ? "適用中…" : "保存して適用"}
            </button>
          </div>
        </>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm">
          {notice}
        </p>
      )}
    </ActionDialog>
  );
}
