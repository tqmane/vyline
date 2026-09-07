# UI design systems

更新: 2026-09-08

外観・UI設定から、Classic、Messages、Fluent、Miuix、NezuUIを切り替える。
選択はブラウザの `vyline:design-system` に保存し、アカウント設定や既存VyThemeと分離する。
機能と情報の基準は現在のVyline。参照アプリに存在しない機能も削除しない。

## 実装の境界

| 領域 | 実装 |
| --- | --- |
| 認証・同期・LINE通信・送信状態 | 既存の `authStore`、`lib/store.ts`、backend、protocol |
| 入力・添付File・録音・メンション・送信 | 常設の既存 `MessageInput` と `composer-controller.ts` |
| Messages / Fluent / Miuixの一覧、履歴、入力欄、設定、2〜4ペイン | `apps/compose-ui` のKotlin / Compose Multiplatform / WasmJs |
| LINEのFlex/Rich、連絡先、位置情報、ファイル、通話イベント、ノート通知、組み合わせスタンプ等 | Kotlinの一覧内に置いた `HtmlElementView` に既存React部品を接続 |
| 詳細設定、バックアップ、スタンプ・絵文字カタログ、ノート・アルバム編集、通話パネル | 既存部品を共有。新UIの操作から開く |
| Classic / NezuUI | React。NezuUIのportable部品はホストのデータとcallbackを受ける |

`ChatShell` はアカウントが同じ間、各トークのproduct controllerを維持する。
画面幅・UI選択・設定画面への移動で、待機中のFileやMediaRecorderを作り直さない。
KMP側にはLINE用API client、認証情報、送信処理、録音処理を追加していない。

`kmp-pane-bridge.tsx` がトークごとの読み取り用modelを作る。
`kmp-app-host.tsx` が同一originのiframeへsnapshot/patchを送り、操作を既存callbackへ戻す。
frame source、origin、version、account epoch、表示中のchat IDを検証する。
各Composeペインは変更されない `UiActionScope` を持ち、フォーカスの変更で送信先が混ざらない。

通常の入力はcomposerの差分だけを送る。受信は変更メッセージと必要なID順序を送り、
複数ペインでは対象ペインの差分だけを送る。Kotlinは既存メッセージの参照を保ち、
`LazyColumn` で表示範囲だけを構成する。

## デザイン

- Messages: 実際のBackdropのvibrancy/blur/lensを使用。iPhoneの下部検索、独立した追加ボタン、
  細い入力欄、入力時の送信カプセル、iPadのインセット一覧と中央のavatar/name pillを実装。
  Shapesの連続曲率、利用者が提供したSF Symbols原本を使用する。
- Fluent: 実際のCompose Fluent NavigationView、Mica、ListItem、TextField、Button、Switcherを使用。
- Miuix: 実際のMiuix TopAppBar、Card、NavigationBar、TextField、Switchを使用。
- NezuUI: [採用記録](./nezu-adoption.md)を参照。カタログの仮送信・仮録音は移植していない。

全モードでメッセージ時刻・送信状態・返信・リアクション・編集・取消・既読者と既読日時を扱う。
既読時刻が取得できていない場合、時刻を作らず名前だけを表示する。
検索・アナウンス・進行中グループ通話は既存ChatAreaの状態・操作を共有する。

## Webの描画

Reactを隠した上に、1つのCompose iframeが主要画面を描画する。分割表示でもWasm runtimeを増やさない。
特殊カードは同じReact storeを読むportalであり、別のアプリや仮のデータストアではない。
カードのCSSはShadowRootに隔離し、表示設定の変化を反映する。

HTMLの動画・音声・動くスタンプ・特殊カードはcanvasの上にあるため、Composeのclipだけには頼らない。
メッセージ表示領域に対応するDOMのclipを適用し、ヘッダー・入力欄・メニューを覆わないようにする。
これらHTML部分はBackdropの画像取り込み対象外。静止画と通常のスタンプはSkiaで描画する。
固定viewportの `overflow: clip` は、HTMLへのフォーカスでcanvas全体がスクロールすることを防ぐ。

Wasm GC対応ブラウザが必要。ロードエラー時には再試行とClassicへの切替を表示する。
日本語とUnicode絵文字は同梱のNoto Sans JP / Noto Color Emojiを使う。
フォント・WasmはComposeモードを初めて開いたときに読み込む。

## ビルドと検証

Java 17以上、Bun、同梱のGradle wrapperを使う。

```powershell
bun run dev
bun run typecheck
bun run lint
bun test Vyline/apps/desktop/src
bun run build
```

Gradle出力は `apps/compose-ui/dist/gradle`。
配布物を `apps/desktop/public/dist/ui-compose` へコピーし、Viteが最終的に
`apps/desktop/dist/dist/ui-compose` へ含める。iframe URLは `/dist/ui-compose/index.html`。
既存の `dist/` 除外を使うため、生成されたKotlin/Skiko JavaScriptをソースlintへ混ぜない。

実Chromeの検証スクリプトは `apps/desktop/scripts/check-kmp-*.ts`。
`VYLINE_TEST_URL` でbase URLを指定する。直接の状態照合を使う検証はViteで実行し、
通常のchat/actions/contentとスクロール性能はproduction previewでも確認する。
`/pr-demo` の隔離contextで、実際のCompose canvasへのポインタ・キー入力と共有storeの結果を確認する。
アクセシビリティ用DOMを人工的にclickする方法は使わない。

| スクリプト | 確認範囲 |
| --- | --- |
| `check-kmp-chat.ts` | 3モードの複数行送信、返信、添付選択/削除、切替・resize時の状態維持、設定の復元 |
| `check-kmp-actions.ts` | メンション/絵文字、編集、リアクション、取消、録音と取消、一覧への復帰 |
| `check-kmp-parity.ts` | 時刻、既読者/日時、長押し、返信ジャンプ、検索、アナウンス |
| `check-kmp-panes.ts` | 2〜4ペイン、入力先・下書きの分離、配置・サイズ変更、狭幅と閉じる |
| `check-kmp-content.ts` / `check-kmp-hosted-actions.ts` | 特殊カード本文、編集/部分コピー/履歴/拡大の重なり、表示設定、viewport維持 |
| `check-kmp-performance.ts` | 5000件と画像、スクロール後の入力、仮想化、任意の連続受信fixture |
| `check-composer-resize.ts` | Classicの同一composer、待機File、録音が幅変更で維持されること |

実アカウントの送信・通話・バックアップ実行は未検証。利用者の指示により、今回の通信検証はデモを使用した。
ブラウザの画面幅/DPR検証と、実機SafariやAndroid端末での検証は区別する。

## 参照・採用元

[機能inventory](./feature-inventory.md)、[NezuUI採用記録](./nezu-adoption.md)、
[KMP依存関係とライセンス](../../apps/compose-ui/README.md)を参照。
実行結果・性能値・未検証範囲は[検証記録](./verification.md)にまとめた。
外部参照repositoryは比較・素材確認に使い、既存submodule、backend API、LINE protocolは置き換えていない。
