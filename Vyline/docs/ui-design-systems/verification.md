# 検証記録 — 2026-09-08

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
