# トーク再取得と1対1ビデオ通話

既存の `../plan.md` / `../todo.md` は別作業のため変更しない。

## 機能と順序

| ID | 目的 | 依存 |
|---|---|---|
| chat-refresh | 指定位置のボタンで一覧・トークを再取得 | 既存ストア |
| video-media | Windows LINEとの暗号化された双方向映像・音声 | 既存通話、ネイティブ形式の確認 |
| video-upgrade | 音声通話を切らずにビデオ開始・停止 | video-media |
| call-layout | 枠と名前、小窓の移動/入替、分割/一覧/固定表示。音声は参加者カード | video-media、グループ参加者契約 |
| modal-viewport | イベント/くじ/ノート/投票/アルバムを画面内に表示 | 共通Modalと親要素の実測 |
| group-call | 指定の「てすたや」で音声・映像、参加者とSSRCの対応 | 既存group prototype、native XRTP/会議通知の確認 |
| call-docs | 実装・暗号/パケット・UI・テスト・制限をMarkdownで記録 | 全実装と検証 |

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
- グループ通話の実測送信先は `c932e3b8ae8bf6b0fc19b512c40cda944`（てすたや）だけ。実測が2参加者の場合、3人以上は合成テストと区別する。
- カメラはユーザー操作で開始する。まず制御されたテストパターンで検証する。
- 新しい認証方式、データ永続化、外部サービス、依存追加が必要なら先に確認する。
- 配布はPR経由。Vylineだけを更新し、既存設定・ボリューム・他サービスを保持する。

## リスクと確認点

- PLANET映像はEVS3。通常のH.264 RTPと同一とは扱わない。実測・ネイティブ実装・固定fixtureで確認する。
- 映像開始は既存通話へのMCMMD制御。切断・再発信で代用しない。
- ブラウザのコーデック対応は実環境で確認し、未対応時は明確なエラーを表示する。
- 一覧/トーク再取得は320pxからデスクトップ幅で確認する。

## 2026-09-06 追加要件の受け入れ条件

1. 通話レイアウト: 小窓がマウス/タッチで画面内を移動し、ドラッグでは入替しない。タップ/キーボードで自分と相手を入替し、媒体DOM・カメラ・音声接続を作り直さない。薄い枠と名前、分割・一覧・固定対象の選択を用意する。
2. モーダル: 指定5画面でタイトル・閉じる操作が常に可視、本文だけをスクロールできる。親要素のtransform/filter、320px幅、低い画面で再現・検証する。フォームの作成/送信テストは勝手に行わない。
3. グループ: 既存のprototypeを根拠にしすぎず、実サービスの会議情報と参加者/SSRCを確認して接続する。会議参加/退出、音声、映像、複数参加者の表示を層ごとに検証する。未実装の形式は広告せず、暗号化を弱めない。
4. docs: ソース参照とネイティブ根拠、再現可能な検証コマンド、実機で確認した範囲と残る制約を記す。
