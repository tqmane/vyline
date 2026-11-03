import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/api/client";
import type { AccountSettings } from "@vyline/types";
import { captureAccountContext } from "@/lib/accountContext";
import { Toggle } from "./vy-ui";
import { SettingsCard as Card, SettingsRow as Row } from "./settings-layout";
import { requestBrowserNotificationPermission } from "@/lib/browserNotifications";

export function BrowserNotificationSettings() {
  const settings = useStore(state => state.settings);
  const update = useStore(state => state.updateSetting);
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="mt-4"><Card>
    <Row title="ブラウザ・PC通知" desc={`LINEのモバイル通知とは別の設定です。OS権限: ${permission}。このブラウザ内の全アカウントに適用します。`}>
      <Toggle label="ブラウザ・PC通知" checked={settings.webNotificationsEnabled ?? false} disabled={busy || permission === "unsupported"} onChange={enabled => {
        setError("");
        if (!enabled) { update("webNotificationsEnabled", false); return; }
        setBusy(true);
        const owner = useStore.getState().accountId;
        // Permission is requested synchronously from this explicit click.
        void requestBrowserNotificationPermission().then(result => {
          setPermission(result);
          if (useStore.getState().accountId !== owner) return;
          update("webNotificationsEnabled", result === "granted");
          if (result !== "granted") setError("通知は有効になっていません。拒否した場合はブラウザ・OSの設定から許可してください。");
        }, () => setError("通知権限を確認できませんでした")).finally(() => setBusy(false));
      }} />
    </Row>
    <Row title="通知本文を伏せる" desc="配信者モード中はこの設定にかかわらず本文を表示しません。">
      <Toggle label="通知本文を伏せる" checked={settings.hideNotificationContent ?? true} onChange={value => update("hideNotificationContent", value)} />
    </Row>
  </Card>{error && <p role="alert" className="mt-2 text-sm">{error}</p>}</div>;
}

export function PrivacyMaskSettings() {
  const settings = useStore(state => state.settings);
  const update = useStore(state => state.updateSetting);
  return <>
    {([ ["streamerMaskNames", "名前を伏せる"], ["streamerMaskAvatars", "アバターを伏せる"], ["streamerMaskUrls", "URLとリンクプレビューを伏せる"] ] as const).map(([key, title]) => <Row key={key} title={title} desc="配信者モードがONのとき適用します。">
      <Toggle label={title} checked={settings[key] ?? true} onChange={value => update(key, value)} />
    </Row>)}
  </>;
}

export function MediaSaveSetting() {
  const enabled = useStore(state => state.settings.mediaAutoSave ?? true);
  const update = useStore(state => state.updateSetting);
  const mid = useStore(state => state.self.mid);
  const accountId = useStore(state => state.accountId);
  const demo = useStore(state => state.demoMode);
  const [storage, setStorage] = useState<(AccountSettings["storage"] & { mediaAutoSave?: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!mid || demo) return;
    const context = captureAccountContext(useStore);
    setStorage(null);
    void api.settings.account(mid).then(result => {
      if (!context.isCurrent()) return;
      if (!result.ok) throw new Error("load");
      const value = result.settings.storage as AccountSettings["storage"] & { mediaAutoSave?: boolean };
      setStorage(value); update("mediaAutoSave", value.mediaAutoSave !== false);
    }).catch(() => { if (context.isCurrent()) setError("自動保存の設定を読み込めませんでした"); });
    return () => context.dispose();
  }, [mid, accountId, demo, update]);
  return <><Card><Row title="表示したメディアを自動保存" desc="このアカウントの設定です。OFFでも一時表示と明示的ダウンロードは利用できます。保存済みファイルは削除しません。">
    <Toggle label="表示したメディアを自動保存" checked={enabled} disabled={busy || (!demo && (!mid || !storage))} onChange={value => {
      if (demo) { update("mediaAutoSave", value); return; }
      if (!mid || !storage) return;
      const context = captureAccountContext(useStore); setBusy(true); setError("");
      const next = { ...storage, mediaAutoSave: value };
      void api.settings.saveAccount(mid, { storage: next }).then(result => {
        if (!context.isCurrent()) return;
        if (!result.ok) throw new Error("save");
        setStorage(next); update("mediaAutoSave", value);
      }).catch(() => { if (context.isCurrent()) setError("設定を保存できませんでした。現在の設定を保持します。"); }).finally(() => { if (context.isCurrent()) setBusy(false); context.dispose(); });
    }} />
  </Row></Card>{error && <p role="alert" className="mt-2 text-sm">{error}</p>}</>;
}

export function LinkPreviewSettings() {
  const settings = useStore(state => state.settings);
  const update = useStore(state => state.updateSetting);
  return <Card>
    <Row title="URLのプレビューを取得" desc="ONにするとメッセージ内URLへサーバーからアクセスします。初期設定では取得しません。">
      <Toggle label="URLのプレビューを取得" checked={settings.requestUrlPreviews ?? false} onChange={value => update("requestUrlPreviews", value)} />
    </Row>
    <Row title="1メッセージのプレビュー数" desc="0で取得なし。最大3件。">
      <select aria-label="1メッセージのプレビュー数" value={settings.linkPreviewMaxUrls ?? 1} onChange={event => update("linkPreviewMaxUrls", Number(event.target.value))}>
        {[0, 1, 2, 3].map(value => <option key={value} value={value}>{value}件</option>)}
      </select>
    </Row>
  </Card>;
}
