import { SettingsRow as Row, SettingsCard as Card, SettingsSection as Section } from "./settings-layout";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Toggle } from "@/components/vy-ui";
import { api } from "@/api/client";
import { BETA_FEATURES, betaFeatureIdForSetting, getBetaFeatureConsentHistory, recordBetaFeatureDecision, withdrawBetaFeature, type BetaSetting } from "@/lib/betaConsent";
export { hasBetaFeatureConsent } from "@/lib/betaConsent";

export function BetaSection() {
  const settings = useStore((s) => s.settings);
  const updateSetting = useStore((s) => s.updateSetting);
  const accountId = useStore((s) => s.accountId);
  const [mid, setMid] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [history, setHistory] = useState(getBetaFeatureConsentHistory);
  const [profile, setProfile] = useState<{
    mid: string;
    displayName: string;
    statusMessage: string;
  } | null>(null);
  const [consentPending, setConsentPending] = useState<
    "betaBlockCheckManual" | "betaBlockCheckAuto" | "betaMidSearch" | "betaAgentI" | null
  >(null);

  const requestEnable = (
    key: "betaBlockCheckManual" | "betaBlockCheckAuto" | "betaMidSearch" | "betaAgentI",
  ) => {
    setConsentError(null);
    setConsentPending(key);
  };

  const withdraw = (key: BetaSetting) => {
    if (!withdrawBetaFeature(betaFeatureIdForSetting(key), () => updateSetting(key, false)))
      setConsentError("機能はOFFにしましたが、撤回履歴を保存できませんでした。保存領域を確認してください。");
    setHistory(getBetaFeatureConsentHistory());
    if (key === "betaMidSearch") setProfile(null);
  };

  const agree = () => {
    if (!consentPending) return;
    if (!recordBetaFeatureDecision(betaFeatureIdForSetting(consentPending), "accepted")) {
      setConsentError("同意を保存できないため、有効にできません。保存領域を確認して再試行してください。");
      return;
    }
    try { updateSetting(consentPending, true); }
    catch {
      try { updateSetting(consentPending, false); } catch { /* Persist updates memory before throwing. */ }
      recordBetaFeatureDecision(betaFeatureIdForSetting(consentPending), "withdrawn");
      setConsentError("設定を保存できないため、有効化を取り消しました。保存領域を確認してください。");
      return;
    }
    setHistory(getBetaFeatureConsentHistory());
    setConsentPending(null);
  };

  return (
    <Section title="ベータ機能" desc="試験的な機能です。挙動や仕様は変更される場合があります。">
      <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed">
        ベータ機能の同意記録と確認結果はこの端末のローカルストレージに保存します。
        同意はこのブラウザ内の全アカウントで共通です。OFFにすると撤回を記録し、再有効化には再同意が必要です。
        Agent Iへ明示的に送信する入力・選択した会話はYahooへ送信されます。LINEとの通常の通信も発生します。
      </div>

      <Card>
        <Row
          title="プロフィールにブロック確認ボタンを表示"
          desc="プロフィール画面から、対象ユーザーのブロック状態を確認できるようにします。"
        >
          <Toggle
            checked={settings.betaBlockCheckManual}
            onChange={(value) =>
              value
                ? requestEnable("betaBlockCheckManual")
                : withdraw("betaBlockCheckManual")
            }
            label="プロフィールのブロック確認"
          />
        </Row>
        <Row
          title="ブロックの自動確認（友だちのみ全員）"
          desc="友だち一覧を対象に、API 制限を避けるため時間をかけて順番に確認します。"
        >
          <Toggle
            checked={settings.betaBlockCheckAuto}
            onChange={(value) =>
              value
                ? requestEnable("betaBlockCheckAuto")
                : withdraw("betaBlockCheckAuto")
            }
            label="自動ブロック確認"
          />
        </Row>
        <Row
          title="MID でユーザー検索（Beta）"
          desc="u + 32桁の16進数のMIDからプロフィールだけを検索します。"
        >
          <Toggle
            checked={settings.betaMidSearch}
            onChange={(value) =>
              value ? requestEnable("betaMidSearch") : withdraw("betaMidSearch")
            }
            label="MID検索"
          />
        </Row>
        <Row
          title="Agent I AIアシスタント"
          desc="質問・文章支援・明示選択したトークの要約を行います。入力内容はYahooへ送信されます。"
        >
          <Toggle
            checked={settings.betaAgentI}
            onChange={(value) =>
              value ? requestEnable("betaAgentI") : withdraw("betaAgentI")
            }
            label="Agent I AIアシスタント"
          />
        </Row>
      </Card>

      {settings.betaMidSearch && (
        <Card>
          <div className="py-4">
            <p className="text-sm font-medium">ユーザー MID を検索</p>
            <div className="mt-2 flex gap-2">
              <input
                value={mid}
                onChange={(event) => setMid(event.target.value.trim())}
                placeholder="u + 32桁の16進数"
                className="min-w-0 flex-1 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm"
                spellCheck={false}
              />
              <button
                type="button"
                disabled={searching || !accountId}
                onClick={async () => {
                  if (!accountId || !/^u[0-9a-f]{32}$/i.test(mid)) {
                    setSearchError("u + 32桁の16進数で入力してください");
                    setProfile(null);
                    return;
                  }
                  setSearching(true);
                  setSearchError(null);
                  setProfile(null);
                  try {
                    const response = await api.line.contactProfile(accountId, mid);
                    if (!response.ok || !response.profile)
                      throw new Error("ユーザーが見つかりません");
                    setProfile({
                      mid,
                      displayName: response.profile.displayName,
                      statusMessage: response.profile.statusMessage,
                    });
                  } catch (error) {
                    setSearchError(error instanceof Error ? error.message : "検索に失敗しました");
                  } finally {
                    setSearching(false);
                  }
                }}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
                style={{ background: "var(--vy-accent)" }}
              >
                {searching ? "検索中…" : "検索"}
              </button>
            </div>
            {searchError && <p className="mt-2 text-xs text-red-400">{searchError}</p>}
            {profile && (
              <div className="mt-3 rounded-lg border border-[var(--vy-border)] p-3 text-xs">
                <p className="font-semibold">{profile.displayName || profile.mid}</p>
                <p className="mt-1 break-all text-[var(--vy-text-dim)]">{profile.mid}</p>
                {profile.statusMessage && <p className="mt-1">{profile.statusMessage}</p>}
              </div>
            )}
          </div>
        </Card>
      )}

      {consentPending && (
        <div className="mt-4 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-4 text-sm">
          <p className="font-semibold">ベータ機能の個別同意</p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--vy-text-dim)]">
            {consentPending === "betaAgentI"
              ? "明示的に送信する入力や選択した会話をYahooへ送信します。個人情報や秘密情報を入力しないでください。自動送信はしません。"
              : "友だち一覧または指定MIDのプロフィールを端末上で処理し、LINEと通信します。"}
            機能ごとの同意・撤回履歴はこのブラウザ内だけに保存します。
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={agree}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--vy-accent-contrast)]"
              style={{ background: "var(--vy-accent)" }}
            >
              同意して有効化
            </button>
            <button
              type="button"
              onClick={() => {
                if (!recordBetaFeatureDecision(betaFeatureIdForSetting(consentPending), "declined")) setConsentError("不同意の履歴を保存できませんでした");
                setHistory(getBetaFeatureConsentHistory());
                setConsentPending(null);
              }}
              className="rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
      {consentError && <p role="alert" className="mt-3 text-sm text-red-400">{consentError}</p>}
      <details className="mt-4 text-xs">
        <summary>同意・撤回履歴（{history.length}件）</summary>
        <p className="my-2">設定JSONから同意は復元しません。復元時は全ベータ機能をOFFにして記録します。</p>
        {history.map((event, index) => <p key={index}>{event.occurredAt} · {Object.entries(BETA_FEATURES).find(([, id]) => id === event.featureId)?.[0] ?? event.featureId} · {event.decision}</p>)}
      </details>
    </Section>
  );
}
