import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { ActionDialog } from "./action-dialog";

export function GroupInviteReject({ accountId, chatId, onClose }: { accountId: string; chatId: string; onClose: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [friends, setFriends] = useState<Array<{ mid: string; displayName: string }>>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void api.line.getGroupInviteReject(accountId, chatId).then(result => {
      if (cancelled || useStore.getState().accountId !== accountId) return;
      if (!result.ok || !result.rule || !result.friends) throw new Error(result.error || "友だちと設定を取得できませんでした");
      setEnabled(result.rule.enabled); setSelected(new Set(result.rule.targetMids)); setFriends(result.friends);
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, chatId, retry]);
  const visible = useMemo(() => friends.filter(friend => friend.displayName.toLowerCase().includes(query.toLowerCase())), [friends, query]);
  async function save() {
    if (loading || saving || error || useStore.getState().accountId !== accountId) return;
    setSaving(true); setNotice("");
    try {
      const result = await api.line.saveGroupInviteReject(accountId, chatId, { enabled, targetMids: [...selected] });
      if (useStore.getState().accountId !== accountId) return;
      if (!result.ok) throw new Error(result.error || "保存できませんでした");
      setNotice(result.warning || "設定を保存しました");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }
  return <ActionDialog title="招待拒否" onClose={onClose}>
    <p className="mb-4 text-sm text-[var(--vy-text-dim)]">このグループで、選択した友だちの招待を自動で取り消します。参加済みの対象者は退会させます。</p>
    {loading ? <p role="status">友だちを読み込み中…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>再読み込み</button></div> : <>
      <label className="mb-4 flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={enabled} disabled={saving} onChange={event => setEnabled(event.target.checked)} />このグループで有効にする
      </label>
      <input type="search" aria-label="招待拒否の友だちを検索" placeholder="名前で検索" value={query} onChange={event => setQuery(event.target.value)} className="mb-3 w-full rounded-lg bg-[var(--vy-surface-2)] p-3" />
      <p className="mb-2 text-xs text-[var(--vy-text-dim)]">友だち {friends.length}人 · 選択 {selected.size}人</p>
      <fieldset className="max-h-72 space-y-2 overflow-y-auto">
        <legend className="sr-only">対象の友だち</legend>
        {visible.map(friend => <label key={friend.mid} data-native-label={friend.displayName} className="flex min-h-11 items-center gap-3 rounded-lg bg-[var(--vy-surface-2)] p-3">
          <input type="checkbox" checked={selected.has(friend.mid)} disabled={saving} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(friend.mid); else next.delete(friend.mid); return next; })} />
          <span className="min-w-0"><strong className="block text-sm">{friend.displayName}</strong></span>
        </label>)}
        {visible.length === 0 && <p className="py-3 text-sm">該当する友だちはいません</p>}
      </fieldset>
      <div data-native-strip="true" className="mt-4 flex gap-3">
        <button type="button" disabled={saving || !selected.size} className="min-h-11 rounded-lg px-4" onClick={() => setSelected(new Set())}>選択をクリア</button>
        <button type="button" disabled={saving} className="min-h-11 rounded-lg bg-[var(--vy-accent)] px-4 text-[var(--vy-accent-contrast)]" onClick={() => void save()}>{saving ? "適用中…" : "保存して適用"}</button>
      </div>
    </>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
  </ActionDialog>;
}
