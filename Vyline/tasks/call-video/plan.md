# トーク再取得と1対1ビデオ通話

既存の `../plan.md` / `../todo.md` は別作業のため変更しない。

## 機能と順序

| ID | 目的 | 依存 |
|---|---|---|
| chat-refresh | 指定位置のボタンで一覧・トークを再取得 | 既存ストア |
| video-media | Windows LINEとの暗号化された双方向映像・音声 | 既存通話、ネイティブ形式の確認 |
| video-upgrade | 音声通話を切らずにビデオ開始・停止 | video-media |

各仕様は同じディレクトリの `SPEC-<ID>.md`、進捗は `todo.md` を正本とする。
小さい変更ごとにテスト・ビルド・保存を行う。映像の送信形式は推測で実装しない。

## 共通コマンド

リポジトリルートから実行する。

- テスト: `bun test`
- 型: `bun run typecheck`
- UIビルド: `bun run build`
- Lint: `bun run lint`
- Protocol型: `bun run --cwd Vyline/packages/protocol stack:types`
- Protocol通話テスト: `tools/data/re-tools/deno-2.9.6/deno.exe test -A --no-check --unstable-sloppy-imports Vyline/packages/protocol/stack/client/features/call`

## 構造・スタイル

- `apps/desktop/src/components`, `hooks`, `lib`: React + Zustand。既存CSS変数とSVGアイコンを利用。
- `backend/src/api`, `call`: 認証済みHTTP/WS境界と通話ライフサイクル。
- `packages/protocol/stack/client/features/call`: ネイティブ信号・暗号・パケット処理。
- テストは隣接する既存のBun/Denoテスト形式を使う。

```ts
await refreshMessages(chatId, { force: true });
// ページ全体の再読み込みや下書きの初期化はしない。
```

## 境界

- 必須: 既存音声・アカウント分離・認証・暗号化を維持。入力サイズ、キュー、フラグメントを制限。
- 禁止: Androidの再起動・Frida・追加テスト、秘密情報/映像のログ保存、平文へのフォールバック。
- Windows LINEのFrida観測とユーザー指定のテストアカウントだけを使う。
- カメラはユーザー操作で開始する。まず制御されたテストパターンで検証する。
- 新しい認証方式、データ永続化、外部サービス、依存追加が必要なら先に確認する。
- 配布はPR経由。Vylineだけを更新し、既存設定・ボリューム・他サービスを保持する。

## リスクと確認点

- PLANET映像はEVS3。通常のH.264 RTPと同一とは扱わない。実測・ネイティブ実装・固定fixtureで確認する。
- 映像開始は既存通話へのMCMMD制御。切断・再発信で代用しない。
- ブラウザのコーデック対応は実環境で確認し、未対応時は明確なエラーを表示する。
- 一覧/トーク再取得は320pxからデスクトップ幅で確認する。
