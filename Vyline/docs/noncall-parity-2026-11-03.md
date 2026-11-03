# 非通話機能の補完と検証（2026-11-03）

## 対象と保護境界

- 実装先: `tqmane/vyline`、基準 `d9abafc9e74893be3efcf82fbce409470563cd1a`。
- 比較元: `nezumi0627/vyline`、再取得時点 `f239927c2696c108d5cf87da134af32071ca7df5`（資料の `e16fc8b` から更新あり）。参照専用。
- 実行環境: Linux。変更は `Vyline/` 内、作業ブランチ `codex/noncall-feature-parity`、PR は `tqmane/vyline` 宛ての1本。
- 通話・録画・録音・通話イベント、既読者・初回既読時刻・既読範囲の処理は保護し、上流の方式に置換しない。
- 独自UI、Compose/Wasm、split pane、React bridge、ChatGPT連携、既存DB形式を維持する。
- 実アカウント操作や外部への診断自動送信は行わず、fixtureとローカルテストを使う。

## 実装・検証結果

| 順序 | 範囲 | 受け入れ条件 | 確認方法 | 状態 |
| --- | --- | --- | --- | --- |
| 1 | CHAT-09/07 | 保存済み原文と添付が相手の取消後も残り、明示削除は復活しない | DB・イベント・表示fixture、再オープン・バックアップ・ブラウザキャッシュ | fixture確認済み |
| 2 | CHAT-01 | DB検索、regex、未ロード履歴への移動、pane/account分離 | 日本語・絵文字・100件超・不正/遅延regex・中断・native controller | fixture確認済み |
| 3 | CHAT-02 / AUX-03 | opt-inで安全なURL取得、SSRF/過負荷/秘匿URLを拒否 | DNS固定・redirect・内部IP・本文/画像上限・秘密クエリ・悪意あるHTML | mock確認済み |
| 4 | SOC-01〜07 | 既存プロフィール/グループ/ノートを維持し不足操作を接続 | readonly MID→個別確認、group/room、画像拡大、ノート詳細、友だち区別、ブロック永続化 | mock/UI確認済み |
| 5 | SET-01〜04/06〜11 | サポート、診断確認、設定JSON、同意履歴と各設定が画面から利用可能 | 秘匿化・ZIP展開・復元・Storage失敗・通知・privacy・native設定 | fixture確認済み |
| 6 | SET-05 | 匿名/任意認証モード、メモリ限定セッション、期限・削除・account分離 | Cookie/履歴は明示送信、期限・削除・ログアウト時破棄、通信mock | mock/UI確認済み |
| 7 | CHAT-03〜08 | 既存DB・スクロール・表示・既読の回帰を確認 | 既存回帰suite、保護領域の機械比較 | 既存方式維持 |
| 8 | 統合 | 型・lint・build・UI確認、1本のPR | 下記実行結果と制限 | ローカル確認済み、Linux最終実行は未完了 |

Windows認証候補（SET-12）はLinuxのため適用外。任意のCLI/MCP（AUX-01）と新規カタログ（AUX-02）は追加せず、既存の連携・fixtureを使う。

## 証跡

`bun run vyl:doctor`: Bun 1.4.0、submodule、依存ディレクトリを検出。環境ファイル未作成のため終了1。テストのために実認証情報は作成しない。

ローカル検証環境は Windows / Bun 1.4.0 / Chrome。実アカウントへの送信・招待・友だち変更は実行していない。

- `bun test`: 1004 pass / 0 fail、192ファイル。SQLite等の隔離プロセス内の追加ケースは各suiteで別途実行される。
- `bun run typecheck`: protocol/backend/desktop/CLI/create-plugin/vylを確認。
- `bun run lint`: 全対象で成功。新規コードの抑制ルール追加なし。
- `bun run build`: Compose/Wasmの生成を含め成功。
- `bun tests/noncall-parity.browser.mjs`（desktopディレクトリ）: legacy/NezuUI/iMessage/Fluent/Miuix × 375×667 / 390×844 / 768×1024 / 1440×900の20ケース。取消後の原文・設定カテゴリの実表示、pageerror 0を確認。通信はlocalhost以外を遮断。
- `bun tests/social-profile.browser.mjs`: プロフィール・友だち操作・group/room・ノート・native確認/画像拡大の14チェック成功、pageerror 0。
- 検索用ブラウザfixture、URL preview hook、Agent Iのブラウザテストもmock接続で実行。
- 既存の通話・既読の51関数/分岐をTypeScript AST単位で基準コミットと比較し一致。通話専用ファイル、`readReceiptRanges.ts`、submoduleの差分なし。
- Linux / Bun 1.4.0でも型チェックとlintを実行したが、最終変更後の全体テストとbuild/runtimeの完走確認は行っていない。

## 取消保持の原因と修復

1. 受信/取消イベントをDB commit前に公開していた。原文保存→取消snapshot保存→通知へ順序を変更し、保存中のセッション交代後には公開しない。
2. `UNSENT`/`UNSEND`の履歴取得で通常行を上書きし、原文snapshot生成前に本文・添付情報を失っていた。placeholderと取消済み状態を統合時に識別し、後着した原文や古いsnapshotからも保存済みの原文を保持する。
3. Composeでは取消済みを一律に置換表示し、既存のReact原文rendererへ到達していなかった。相手取消の非通話メッセージを既存host rendererへ接続する。自分の取消は既存動作を維持する。
4. 明示削除にはaccount/chat/message単位のtombstoneを使う。相手の取消とは分離し、古い履歴・snapshot・選択バックアップ・表示キャッシュで復活させない。削除失敗時はUIの原文を残す。
5. 元データが一度も届いていないplaceholderに原文を生成しない。保存済みsnapshotのメディア型と復号情報を使い、取消を理由に既存メディアキャッシュを削除しない。

`lineService.revocations.test.ts`、`chatStore.sqlite.test.ts`、`messageRetention.test.ts`、`vyline-hydration.test.ts`に失敗fixtureから追加した回帰ケースがある。read op、readByAtの初回時刻保持、既読マージ・範囲、通常/通知なしの自己取消RPCは変更しない。

## 維持した実装と制限

- CHAT-04/05: `intentionally-different`。既存のaccount別SQLiteを正本とし、大規模履歴はページング・既存LRUウィンドウで読む。上流のDBモデルやIndexedDB永続化への置換は行わない。
- CHAT-06/08、SOC-04/08: `exists / intentionally-different`。既存スクロール、Flex/Rich/スタンプ、プロフィールfallbackを維持し、確認できた不足のノート詳細・画像拡大・検索連携だけを接続した。全既存形式の実端末比較は未実施。
- SET-10: `exists`。ToSは既存のブラウザ単位の同意を維持する。設定JSONからToSや認証状態を読み込まない。
- SET-12: `not-applicable`（Linux）。任意のWindows認証候補スキャン、AUX-01の追加CLI/MCP、AUX-02の新規カタログは追加しない。
- URL追加取得は既定OFF、件数0でも停止、配信者モード中は停止。外部画像は取得・検査したバイトをaccount別プロキシ経由で表示する。
- mediaAutoSaveはaccount別設定。OFFでも一時ファイルによる表示・明示ダウンロード・Rangeを維持する。異常終了時の一時ファイルは次回取得時に1時間以上経過したものだけ掃除する。
- サポートZIPと報告文プレビューはブラウザ内で生成する。専用のネットワークAPIは増やさない。画像は選択・再エンコード・確認後の手動添付。Issueを自動作成したりログを自動アップロードしたりしない。
- 実LINE/Yahoo通信、実アカウントでの再ログイン、物理端末、長時間の実メディア再生は未検証。コードとmockの存在を実サービス成功の保証とはしない。
- 日本語表示文は指定の `agy` / `gemini-3.8-flash-high` / highで5画面を確認し、変更不要との結果。新しい翻訳基盤や言語は追加していない。
