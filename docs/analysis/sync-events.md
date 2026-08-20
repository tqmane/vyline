# sync-events — リアルタイムイベント取得の解析メモ

LINE Desktop / Mobile との受信には、通知を消費しない履歴ポーリング、Operation 同期、Legy Push の経路がある。

## 1. フロント向けイベントポーリング (`pollEvents`)

Vyline の主要な受信パス。

```
GET /line/:accountId/events/poll?cursor=N
```

- `backend/src/line/talkEventBuffer.ts` で **インメモリバッファ** にイベントを蓄積
- `pollIncoming` (store.ts) がこのバッファを drain する
- ポーリング間隔: 背景 2s / 非アクティブ 8s / 非表示 60s（`useVylineSync.ts`）
- バックエンドの受信方式とは独立した、フロント向けバッファ読み出し

### イベント種別

| kind | 説明 | ハンドラ |
|------|------|----------|
| `message` | 新着メッセージ | `mergeIncomingMessages` |
| `revoke` | メッセージ取り消し | `applyRevoked` |
| `read` | 既読通知 | `refreshReadReceipts` (force) |
| `reaction` | リアクション追加/削除 | `pollMessagesDelta` (delta fast-path) |

## 2. バックエンド受信方式

`VYLINE_TALK_SYNC_MODE` で選択する。既定は `history`。

| mode | 方式 | 他端末通知 | 即時に扱えるもの |
|------|------|------------|------------------|
| `history` | `getMessageBoxes` + `fetchMessagesSince` | Operation revision を進めない | 新着メッセージ |
| `sync` | `/SYNC4` | 副端末の通知維持設定を確認してから開始 | メッセージ、通話、既読、取り消し、リアクション等 |
| `off` | 無効 | 影響なし | なし |

`ANDROIDSECONDARY` の `sync` は `NOTIFICATION_DISABLED_WITH_SUB` を取得し、`notificationDisabledWithSub=false` を設定する。設定 RPC に失敗した場合は `history` へ戻る。CHRLINE-Patch で `fetchOps` に付けられていた `x-las` / `x-lam` / `x-lac` は sync リクエスト単位の互換コンテキストとして取り込んだが、未知のキャリアコードは設定しない。

セッション復元直後の listener 開始は `VYLINE_TALK_LISTEN_DELAY_MS`（既定 5 秒）だけ遅延する。

## 3. Legy Push (`ListenAndRead`)

HTTP/2 の `/PUSH/1/subs` エンドポイントでサーバーから即座にイベントを受信。

- `clientManager.ts` の `attachTalkPushBridge` で Talk push を接続
- メッセージ / Operation (DESTROY, READ, REACTION) を即座にバッファへ
- push が機能しない環境ではポーリングで補完

## 4. Operation タイプ（Talk）

`pushTalkEvent` / `handleTalkOperation` で処理される主要な Operation type:

| type | 数値 | 説明 |
|------|------|------|
| `RECEIVE_MESSAGE` | 26 | 新着メッセージ (push) |
| `SEND_MESSAGE_RECEIPT` | 27 | 送信 receipt |
| `RECEIVE_MESSAGE_RECEIPT` | 28 | 受信 receipt |
| `NOTIFIED_READ_MESSAGE` | 55 | 相手既読通知 |
| `NOTIFIED_SEND_REACTION` | 140 | リアクション追加 |
| `NOTIFIED_GCS_REACTION` | 154 | グループ/チャットリアクション |
| `DESTROY_MESSAGE` | (40 系?) | 取り消し |

> 注: `GET /events/poll` の `events` 配列では、push された message を `kind: "message"` としてフロントエンドに渡す。Operation (revoke/read/reaction) は `pushTalkEvent` → `TalkPollEventPayload` として、`kind` で判別してバッファする。

## 5. Desktop 差分

- `bun run vyline:delta` (`reportDesktopDelta.ts`) で Desktop LINE の更新を検出
- 出力: `docs/reports/desktop-delta-YYYYMMDD.md`
- 関連: [docs/tools/vyline-search.md](../tools/vyline-search.md)

## 6. 参考箇所

- **バッファ**: `backend/src/line/talkEventBuffer.ts`
- **poll 受信**: `apps/desktop/src/lib/store.ts` `pollIncoming` (line ~1882)
- **push bridge**: `backend/src/service/lineService.ts` `attachTalkPushBridge` / `handleTalkOperation`
- **delta fast-path**: `fetchMessagesInner` `deltaAfterId` オプション（getMessageBoxes スキップ）
