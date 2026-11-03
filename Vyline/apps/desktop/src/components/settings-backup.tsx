import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useThemeStore } from "@/stores/themeStore";
import { useDesignSystemStore } from "@/ui/design-system-store";
import { captureAccountContext } from "@/lib/accountContext";
import { createSettingsBackup, parseSettingsBackup, recordSettingsRestoreConsent, SETTINGS_BACKUP_MAX_BYTES, type SettingsRestore } from "@/lib/settingsBackup";
import { requestControllerConfirm } from "@/ui/controller-dialog";
import { SettingsCard, SettingsRow, SettingsSection } from "./settings-layout";
import { downloadLocalFile } from "@/lib/supportBundle";

function snapshot() {
  const { settings, theme } = useStore.getState();
  const { themeId, custom } = useThemeStore.getState();
  const { mode, appearance } = useDesignSystemStore.getState();
  return { settings, theme, visualTheme: { themeId, custom }, design: { mode, appearance } };
}

export function SettingsBackupSection() {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<SettingsRestore | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const restore = async () => {
    if (!pending || busy) return;
    const context = captureAccountContext(useStore);
    try {
      if (!await requestControllerConfirm("表示した設定・テーマで上書きします。全ベータ機能をOFFにして同意撤回を記録します。続けますか？", { cancelFirst: true }) || !context.isCurrent()) return;
      setBusy(true);
      const before = snapshot();
      recordSettingsRestoreConsent();
      try {
        useStore.setState({ settings: { ...before.settings, ...pending.settings }, ...(pending.theme ? { theme: pending.theme } : {}) });
        if (pending.visualTheme) useThemeStore.setState(pending.visualTheme);
        if (pending.design) useDesignSystemStore.setState(pending.design);
      } catch {
        // Zustand updates memory before storage; restore memory even if rollback cannot persist.
        try { useStore.setState({ settings: { ...before.settings, betaAgentI: false, betaBlockCheckManual: false, betaBlockCheckAuto: false, betaMidSearch: false }, theme: before.theme }); } catch { /* Memory was restored before the storage error. */ }
        try { useThemeStore.setState(before.visualTheme); } catch { /* Same persist ordering. */ }
        try { useDesignSystemStore.setState(before.design); } catch { /* Same persist ordering. */ }
        throw new Error("保存に失敗したため設定を戻しました。ベータ機能はOFFのままです。保存領域を確認してください。");
      }
      setPending(null);
      setMessage("設定・テーマを復元しました。全ベータ機能はOFFです。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "復元できませんでした"); }
    finally { context.dispose(); setBusy(false); }
  };
  return <SettingsSection title="設定・テーマのバックアップ" desc="このブラウザの設定・テーマだけをJSONで保存します。認証・会話・同意・通話・既読設定は含みません。既存の引継ぎZIPも引き続き利用できます。">
    <SettingsCard>
      <SettingsRow title="設定JSONを書き出す"><button type="button" onClick={() => {
        try { downloadLocalFile("vyline-settings.json", new Blob([createSettingsBackup(snapshot())], { type: "application/json" })); setMessage("設定JSONを保存しました"); }
        catch (error) { setMessage(error instanceof Error ? error.message : "書き出せませんでした"); }
      }}>エクスポート</button></SettingsRow>
      <SettingsRow title="設定JSONを読み込む" desc="15MBまで。内容の確認と上書き確認の後に復元します。">
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>JSONを選択</button>
        <input ref={input} type="file" accept="application/json,.json" aria-label="設定JSONを選択" className="hidden" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = "";
          setPending(null); setMessage("");
          if (!file) return;
          const context = captureAccountContext(useStore);
          try {
            if (file.size > SETTINGS_BACKUP_MAX_BYTES) throw new Error("設定JSONは15MBまでです");
            const text = await file.text();
            if (context.isCurrent()) setPending(parseSettingsBackup(text, snapshot()));
          } catch (error) { if (context.isCurrent()) setMessage(error instanceof Error ? error.message : "読み込めませんでした"); }
          finally { context.dispose(); }
        }} />
      </SettingsRow>
    </SettingsCard>
    {pending && <div className="mt-4 space-y-3">
      <p className="text-sm">復元前プレビュー（未適用）。テーマ画像のURLは復元後にアクセスされます。欠けた項目は現在値を保持します。</p>
      <textarea aria-label="復元前プレビュー" readOnly rows={12} className="w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] p-3 text-xs" value={JSON.stringify(pending, null, 2)} />
      <button type="button" disabled={busy} onClick={() => void restore()}>この内容で復元する</button>
      <button type="button" className="ml-4" onClick={() => setPending(null)}>キャンセル</button>
    </div>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </SettingsSection>;
}
