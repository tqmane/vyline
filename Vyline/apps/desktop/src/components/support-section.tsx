import { useEffect, useRef, useState } from "react";
import { useStore, UPDATE_NOTES } from "@/lib/store";
import { api } from "@/api/client";
import { captureAccountContext } from "@/lib/accountContext";
import { AgentIBetaPanel } from "./agent-i-beta-panel";
import { SettingsCard, SettingsRow, SettingsSection } from "./settings-layout";
import { createSupportZip, downloadLocalFile, prepareSupportImage, redactSupportValue, supportIssuePreview, SUPPORT_REPOSITORY, validateSupportImages } from "@/lib/supportBundle";

type Screenshot = { blob: Blob; preview: string; selected: boolean };
export function SupportSection() {
  const mid = useStore(state => state.self.mid);
  const accountId = useStore(state => state.accountId);
  const demo = useStore(state => state.demoMode);
  const aiEnabled = useStore(state => state.settings.betaAgentI);
  const [fields, setFields] = useState({ summary: "", steps: "", expected: "", actual: "" });
  const [entries, setEntries] = useState<unknown[]>([]);
  const [selectedLogs, setSelectedLogs] = useState<number[]>([]);
  const [includeEnvironment, setIncludeEnvironment] = useState(false);
  const [images, setImages] = useState<Screenshot[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; urls.current.forEach(URL.revokeObjectURL); urls.current.clear(); }; }, []);
  const issue = supportIssuePreview({ ...fields, version: UPDATE_NOTES.version });
  const environment = includeEnvironment ? { version: UPDATE_NOTES.version, language: navigator.language, platform: navigator.platform } : undefined;
  const diagnosticPreview = JSON.stringify(redactSupportValue({ environment, entries: selectedLogs.map(index => entries[index]) }), null, 2);
  const invalidated = () => { setReviewed(false); setMessage(""); };
  const loadLogs = async () => {
    if (!mid || !accountId || demo || busy) return;
    const context = captureAccountContext(useStore);
    setBusy(true); invalidated();
    try {
      const response = await api.diagnostics.list(mid);
      if (!context.isCurrent() || !mounted.current) return;
      if (!response.ok) throw new Error("診断ログを読み込めませんでした");
      setEntries(response.entries.map(entry => redactSupportValue(entry))); setSelectedLogs([]);
      setMessage(response.entries.length ? "共有するログだけを選択してください" : "診断ログは0件です。収集設定は引継ぎ・診断で確認できます。");
    } catch { if (context.isCurrent() && mounted.current) setMessage("診断ログを読み込めません。接続と診断ログ設定を確認してください。"); }
    finally { context.dispose(); if (mounted.current) setBusy(false); }
  };
  const saveZip = async () => {
    if (!reviewed || busy) return;
    const context = captureAccountContext(useStore);
    setBusy(true);
    try {
      const encoder = new TextEncoder();
      const files = [{ name: "issue.md", data: encoder.encode(`# ${issue.title}\n\n${issue.body}`) }, { name: "diagnostics.json", data: encoder.encode(diagnosticPreview) }];
      for (const [index, image] of images.filter(image => image.selected).entries()) files.push({ name: `screenshot-${index + 1}.png`, data: new Uint8Array(await image.blob.arrayBuffer()) });
      if (!context.isCurrent() || !mounted.current) return;
      downloadLocalFile("vyline-support.zip", createSupportZip(files));
      setMessage("診断ZIPを端末に保存しました。送信・アップロードはしていません。必要な場合だけIssueに手動添付してください。");
    } catch { if (context.isCurrent() && mounted.current) setMessage("ZIPを保存できません。画像サイズと保存領域を確認してください。"); }
    finally { context.dispose(); if (mounted.current) setBusy(false); }
  };
  return <SettingsSection title="サポート" desc="内容を確認してから開発者へ報告できます。診断・画像を自動送信しません。ログインなしでも報告文とZIPを作成できます。">
    <SettingsCard>
      <SettingsRow title="開発者に伝える" desc="下のフォームで症状・再現手順を整理します。報告先はtqmane/vylineです。"><a href={`${SUPPORT_REPOSITORY}/issues`} target="_blank" rel="noreferrer">既知の問題</a></SettingsRow>
      <SettingsRow title="AIに相談" desc={!aiEnabled ? "ベータ機能でAgent Iへの同意と有効化が必要です" : "入力を確認してAgent Iの送信ボタンを押すとYahooへ送信されます"}>
        <button type="button" disabled={!aiEnabled || !accountId || demo} onClick={() => setShowAi(value => !value)}>{showAi ? "AIを閉じる" : "AIの入力画面を開く"}</button>
      </SettingsRow>
      <SettingsRow title="ヘルプ"><a href={`${SUPPORT_REPOSITORY}/tree/main/docs`} target="_blank" rel="noreferrer">使い方・診断の案内</a></SettingsRow>
    </SettingsCard>
    {showAi && aiEnabled && <AgentIBetaPanel />}
    <div className="mt-4 space-y-3">
      {([ ["summary", "問題の概要"], ["actual", "実際の症状"], ["steps", "再現手順"], ["expected", "期待した結果"] ] as const).map(([key, title]) => <label key={key} className="block text-sm">{title}
        <textarea aria-label={title} value={fields[key]} maxLength={12000} rows={key === "summary" ? 1 : 3} className="mt-1 w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] p-2" onChange={event => { setFields(value => ({ ...value, [key]: event.target.value })); invalidated(); }} />
      </label>)}
      <label className="block text-sm"><input type="checkbox" checked={includeEnvironment} onChange={event => { setIncludeEnvironment(event.target.checked); invalidated(); }} /> バージョン・ブラウザの言語・OS種別を含める</label>
      <p className="text-xs">{!accountId || demo || !mid ? "未ログイン・デモでは診断ログを取得しません。症状と画像だけで報告できます。" : "診断ログは明示的に読み込み、必要な行だけ選択できます。"}</p>
      <button type="button" disabled={!mid || !accountId || demo || busy} onClick={() => void loadLogs()}>診断ログを読み込む</button>
      {entries.map((entry, index) => <label key={index} className="block break-all text-xs"><input type="checkbox" checked={selectedLogs.includes(index)} onChange={event => { setSelectedLogs(value => event.target.checked ? [...value, index] : value.filter(i => i !== index)); invalidated(); }} />ログ {index + 1}: {JSON.stringify(entry)}</label>)}
      <div><button type="button" disabled={busy} onClick={() => input.current?.click()}>スクリーンショットを追加</button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="スクリーンショットを追加" className="hidden" onChange={async event => {
          const files = Array.from(event.target.files ?? []); event.target.value = "";
          if (!files.length) return;
          const context = captureAccountContext(useStore); setBusy(true); invalidated();
          const added: Screenshot[] = [];
          try {
            validateSupportImages([...images.map(image => image.blob), ...files]);
            for (const file of files) {
              const blob = await prepareSupportImage(file);
              const preview = URL.createObjectURL(blob);
              urls.current.add(preview); added.push({ blob, preview, selected: true });
            }
            validateSupportImages([...images.map(image => image.blob), ...added.map(image => image.blob)]);
            if (!context.isCurrent() || !mounted.current) return;
            setImages(value => [...value, ...added]); added.length = 0;
          } catch (error) { if (context.isCurrent() && mounted.current) setMessage(error instanceof Error ? error.message : "画像を読み込めませんでした"); }
          finally { for (const image of added) { URL.revokeObjectURL(image.preview); urls.current.delete(image.preview); } context.dispose(); if (mounted.current) setBusy(false); }
        }} />
      </div>
      <p className="text-xs">1枚10MiB・合計25MiB・10枚まで。画像の名前と付加情報を除去します。写り込んだ名前・会話・秘密情報は自動では消えません。共有前に画像を確認し、必要なら画像編集ソフトで隠してください。</p>
      {images.map((image, index) => <div key={image.preview} className="space-y-1"><img src={image.preview} alt={`スクリーンショット ${index + 1} の確認`} className="max-h-64 max-w-full object-contain" />
        <label><input type="checkbox" checked={image.selected} onChange={event => { setImages(value => value.map(item => item === image ? { ...item, selected: event.target.checked } : item)); invalidated(); }} />画像 {index + 1} を含める</label>
        <button type="button" className="ml-3" onClick={() => { setImages(value => value.filter(item => item !== image)); URL.revokeObjectURL(image.preview); urls.current.delete(image.preview); invalidated(); }}>画像を削除</button>
      </div>)}
      <h3 className="text-sm font-semibold">共有前プレビュー</h3>
      <textarea aria-label="Issue本文プレビュー" readOnly rows={10} value={`# ${issue.title}\n\n${issue.body}`} className="w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] p-2 text-xs" />
      <textarea aria-label="診断JSONプレビュー" readOnly rows={6} value={diagnosticPreview} className="w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] p-2 text-xs" />
      <label className="block text-sm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> 本文・診断・選択した画像を確認し、共有可能な内容であることを確認しました</label>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!reviewed || busy} onClick={() => void saveZip()}>診断ZIPを端末に保存</button>
        <button type="button" disabled={!reviewed || busy} onClick={() => void navigator.clipboard.writeText(`# ${issue.title}\n\n${issue.body}`).then(() => setMessage("報告文をコピーしました"), () => setMessage("コピーできません。プレビューから手動でコピーしてください。"))}>報告文をコピー</button>
        <button type="button" disabled={!reviewed || busy} onClick={() => { window.open(issue.url, "_blank", "noopener,noreferrer"); }}>GitHubでIssue作成画面を開く</button>
      </div>
      <p className="text-xs">{issue.copyRequired ? "URLが長いため本文は自動入力しません。報告文をコピーして貼り付けてください。" : "GitHubを開くと確認した報告文がURLとして送られます。画像・ZIPは手動で添付してください。"} ZIPの生成・添付は必須ではありません。</p>
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>
  </SettingsSection>;
}
