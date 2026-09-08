# 検証記録 — 2026-09-08

## 全操作監査・表示崩れの追加検証

操作ごとの実装経路、ブラウザ確認、実接続で残る確認は [UI操作全体の監査](interaction-audit.md) に記録。
既読者一覧、アナウンス、メッセージ入力、メニュー、ナビゲーション、詳細設定、通話の追加検証を実施した。操作別のfixture条件、実行したbundle、未検証範囲は同監査記録に分けて記載した。

- Appleの押下spring・ドラッグ変形・動的レンズ/光/影を、参照commonMainからWeb/Wasmへ導入。実タブ文字もレンズへ記録する。
- 実Chrome、390×844/DPR2のlight/dark × 通常/動きを減らす4条件を、最終開発版と配布版の両方で通過。マウス・Space・タッチ、取消、タブのドラッグとキー選択、表示中の設定変更を確認。実CanvasのPNGを比較し、マウスホバーが次のタッチを妨げるCompose 1.12の問題も修正した。
- フロントエンド: **140 tests / 506 assertions / 29 files、0 failures**。frontend lint **164ファイル成功**、TypeScriptビルドと `git diff --check` も成功。
- 外部テーマ4repositoryはclean、参照HEADと一致。追加のSF Symbols **12/12**（通話7・＋5）は原本・コピー・manifestのSHA-256一致。

最終 `bun run build` は成功（Gradle production **4分13秒**、Vite **5.15秒**）。Compose配布物は **34ファイル / 36,656,128 bytes**。
App Wasmは `91b30b2396f88f29a7fd.wasm`、**5,627,825 bytes**、SHA-256 `5BE6FF138FB7A1A8460E11C77DEC9E13281B427FC49BEE845D7C94906C86105F`。
Webpack/Viteのバンドルサイズ警告は残る。配布版の4条件の光学描画・入力結果は `apps/desktop/test-results/apple-liquid-motion-production/`。

同じ最終配布物で `smoke.mjs --production --chat --regressions` も3テーマ成功。返信/メンションのキー操作、開いたメニューへの更新、アカウント分離、ロック中の操作を確認した。

ビルドと他のブラウザ検証を終了後、配布previewで5000メッセージ＋画像、実Chrome、1440×900/DPR2を測定した。

| UI | rAF P95 | 入力反映 | Long task | 入力中の全履歴再送 |
| --- | --- | --- | --- | --- |
| Classic | 31.6ms | 5ms | 0 | 0 |
| Messages | 31.6ms | 42ms | 0 | 0 |
| Fluent | 31.6ms | 37ms | 0 | 0 |
| Miuix | 31.6ms | 33ms | 0 | 0 |

この測定では4モードのフレーム間隔は同程度。前回の18〜19msとは実行時点が異なるため、今回のClassicを比較基準にする。結果と画面は `apps/desktop/test-results/kmp-performance/`。実行時例外は全モード0件。

実LINEの送受信・通話、実機Safari/Android、日本語IMEの物理入力、バックアップ復元は未検証。デモ操作や通話fixtureを実通信の成功とは扱わない。以下の古いビルド値やテスト数は、それぞれの検証時点の記録である。

## 前回: ローカル参照ソースからの追加修正

`C:\Users\Tqmane\Documents\Git\themes` の既存Backdrop、Shapes、Compose Fluent、Miuixを直接確認。
再clone・参照repositoryの変更は行っていない。固定依存と参照HEADの対応は
[Compose README](../../apps/compose-ui/README.md#verified-dependency-choices)に記録した。

- Apple一覧の日時をタイトル行に配置し、2行プレビューの幅を確保。
- 入力欄を表示できないロック・ブロック中も、Appleの詳細画面から検索・トーク操作を開ける。
- Appleの空のトーク検索欄にプレースホルダーを表示。FluentのrootがMica背景を覆わないよう修正。
- Tabのメンション確定、Escによる候補の終了と返信解除を既存composerに揃えた。
- アカウントepochが変わったときは同じchat IDでもnativeの下書き・メニューを破棄。
- 開いたメニューは現在のメッセージを参照。編集開始時も最新本文を使い、取消・削除時は閉じる。
  メディアビューアも取消・削除時に閉じ、メニューや画像が閉じている間は履歴を検索しない。
- 共通の`sendMessage`で返信先を送信先chatに限定。別ペインの返信を誤添付せず、その返信選択を維持。

追加の`smoke.mjs --chat --regressions`は、実canvasへのキー・ポインタ入力で
3テーマのEsc/Tab、開いたメニューへの更新、最新本文の編集、取消時の終了、epoch切替を確認する。
Appleではロック・ブロック時の詳細操作も確認した。これはローカルhost fixtureによる検証。
共通送信の回帰テストは、デモ経路とネットワークを遮断したAPI stubの両方で別chatへの返信混入を検査する。

今回のフロントエンドテストは139件・502 assertions、型チェックとlintも成功。
実Chromeの共有ストア経路では、3テーマの送信・返信・添付選択/削除・切替時の状態保持・
設定復元・編集・リアクション・取消・録音取消・既読日時・検索・アナウンス・2〜4ペイン・
特殊カードの詳細操作を確認した。360〜1440px、Appleの375×667/DPR2を含み、実行時例外と横溢れなし。

最終`bun run build`は成功（Gradle production 4分7秒、Vite 2.89秒）。
配布物は34ファイル・36,528,196 bytes。App Wasmは`97b7f8adfcfa38253225.wasm`、
5,505,355 bytes、SHA-256 `871214720725C912B3C2A060635B7341B4274CB157C820B1B86436FFEBEEFD15`。
最適化後の配布物でも`--production --chat --regressions`を通過。
Webpack/Viteのサイズ警告は残る。Wasm・フォントはCompose選択時だけ読み込む既存構成を維持。

最終配布版、実Chrome、1440×900/DPR2、5000メッセージ＋画像。他のbuild/ブラウザ検証終了後に測定。

| UI | rAF P95 | 入力反映 | Long task | 入力中の全履歴再送 |
| --- | --- | --- | --- | --- |
| Classic | 18.8ms | 5ms | 0 | 0 |
| Messages | 18.7ms | 34ms | 0 | 0 |
| Fluent | 18.8ms | 36ms | 0 | 0 |
| Miuix | 18.6ms | 41ms | 0 | 0 |

追加結果: `apps/desktop/test-results/kmp-chat-final/`、`kmp-content-final/`、
`apple-visual-probe/`、`kmp-performance/results.json`。
フレーム時間は同時に測ったClassic相当で、入力中に全履歴を再送しないことも確認した。

実LINEアカウントの接続検証は未完了。今回の作業環境は`.env`と稼働中backendがなく、
ログイン済み接続先は利用者へ問い合わせ中。デモ送信やAPI stubを実LINE送信の成功とは扱わない。
実機Safari/Android、実通話、バックアップ実行はこの追加検証の対象にできていない。

以下は初回導入時の検証記録。

## ビルドと配布

- `bun run build`: 成功。Gradle production最適化 4分47秒、TypeScript/Viteビルド成功。
- Compose配布物: 36,518,867 bytes / 34ファイル。App Wasmは5,495,996 bytes。
- App Wasm: `1aa5fe66b12eae0159de.wasm`
- SHA-256: `DDA835484DAE4CD952C99C5C8E68E49FE0420E1B56915711A03664BF0FA19FC1`
- `bun run typecheck`、`bun run lint`、release architecture、自前コードの差分検査: 成功。
- フロントエンド: 138 tests、0 failures。
- OFLライセンス原本の末尾空白2行は原本のまま保持。
- SF Symbols 23ファイル: コピー元/コピー先/SHA-256/viewBox一致。
- Bunによる静的配信も実Chromeで起動確認。WasmのMIME、起動スクリプトの再検証、ETag/304を確認。
- Webpack/Viteのバンドルサイズ警告は残る。バイナリ・フォントはCompose選択時だけロードする。

## Chrome

配布版 `:4173` でMessages / Fluent / Miuixそれぞれの送信・複数行・返信・添付選択/削除・
録音取消・編集・リアクション・取消・メディア本文・設定復元・320〜1440pxの主要操作を確認。
追加のVite検証では、時刻/既読日時・長押し・検索・アナウンス・返信ジャンプ・リンク、
2〜4ペインの入力分離/配置/サイズ変更/閉じる、特殊カードの詳細操作、画面外クリップとクリックも確認した。
NezuUI、Classicの録音/添付保持、全5モードの未ログイン画面も確認済み。

`check-kmp-chat.ts`、`check-kmp-actions.ts`、`check-kmp-content.ts` は配布previewでも実行できる。
`parity`、`panes`、`hosted-actions` の状態照合と連続受信fixtureは、Viteが実際にロードしたstore moduleを使う。
いずれも隔離した `/pr-demo`。実LINEのデータや送信先を使っていない。

## 5000メッセージ＋画像

ローカルChrome、1440×900。ビルド/他のブラウザ検証停止後に測定。

| UI | 配布版 DPR 1 rAF P95 | 配布版 DPR 2 rAF P95 | 10件/秒の受信fixture rAF P95 |
| --- | --- | --- | --- |
| Classic | 16.8ms | 16.8ms | 16.8ms |
| Messages | 16.8ms | 16.8ms | 16.8ms |
| Fluent | 16.8ms | 16.8ms | 33.3ms |
| Miuix | 16.9ms | 16.8ms | 16.8ms |

長いtaskは全測定0件。入力時・連続受信時の全履歴再送は0件。
連続受信はViteホスト＋同じproduction Wasmで24件を追加し、最後のメッセージの描画も確認した。
Fluentの連続受信時には33msフレームが残る。

詳細JSON/画像はローカルの `apps/desktop/test-results/`、性能JSONは
`kmp-performance/production-dpr1.json`、`production-dpr2.json`、`production-wasm-stream.json`。

## CIと未検証範囲

CI build、Windows/Linux releaseにはTemurin 17とGradle cacheを設定。
Dockerはビルド段階だけにJDKを含め、Gradle生成物をbuild contextから除外する。
Linux/macOSはwrapperを `sh` で起動し、Windowsで作成したファイルの実行bitに依存しない。
workflow YAML、Java設定、既存quality gateの維持、Docker contextの必要ファイルを静的検証した。

GitHub ActionsとDockerの実行結果は未確認。ローカルにDocker CLIはない。
実LINE送信・通話・バックアップ実行、実機Safari/Androidでの動作は未検証。
