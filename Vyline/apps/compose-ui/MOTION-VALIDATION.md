# Compose Web モーション変更・検証記録

## 状態（2026-09-08）

**コード変更済み。ただし、今回の変更のKotlin/Compose/Wasmコンパイル、production build、3テーマの実ブラウザ動作は未確認。完成・配布可能なビルドとして扱わないでください。**

作業元は添付 `nezu.zip` 内の Vyline、Git HEAD `17324571c9b540e3aa4bf1d5daea15089ff6f6d0`。既に存在したKMPレンダラー、実データbridge、Appleの動的Glassを引き継いでいます。既存READMEに記録されている過去の検証結果は、今回の変更に対するテスト結果ではありません。

## 構成・固定バージョン

モジュール: `Vyline/apps/compose-ui`。Kotlin 2.4.10 / Compose Multiplatform 1.12.0 / `wasmJs { browser(); binaries.executable() }` / Gradle wrapper 9.6.1。

| 依存 | バージョン | 今回の扱い |
| --- | --- | --- |
| Backdrop | 2.0.1 | 維持。Appleの既存動的実装を再利用 |
| Shapes | 1.2.1 | 維持。continuous rounded geometryを使用 |
| Compose Fluent | v0.1.0 | 維持。native menu/dialog APIを追加接続 |
| miuix-ui | 0.9.3 | 維持。native press/sheet/dialogを有効利用 |
| miuix-blur | 0.9.3 | 追加。Maven上の解決・Wasmリンクは未確認 |

TS → same-origin iframe → JSON snapshot/patch → Kotlinという既存方式を維持。Kotlinからの操作は既存のaccount epoch / chat scope付きactionを返します。TSのMessageInput controller、Zustand、API、WebSocket、LINE protocolを再実装していません。

## 変更内容

### Apple

既存 `AppleMotion.kt` / `AppleLiquidTabs.kt` のspring、drag、動的lens、highlight、shadowを残しました。これらを「今回新規に実装した」とは数えません。

今回追加したのは、リアクション選択の実Backdrop光学効果とshared interaction source、メニュー行のpress spring/highlight、メニュー・編集確認surfaceのentry/exitです。閉じる瞬間にcompositionを破棄せず、遷移が終わってから外側の選択状態を消します。元の既読情報、返信、再送、編集、取り消し、詳細へのactionを維持しています。

### Fluent

ホスト由来メニューをCompose Fluentの `MenuFlyout` / `MenuFlyoutItem` に接続しました。階層メニューはライブラリのcascading menuを使います。メッセージ操作・編集確認は `FluentDialog` を使用し、`FluentTheme(useAcrylicPopup = true)` でnative acrylic popupを有効にしました。既存のnative list、buttons、text fields、switches、navigationは維持しています。

ライブラリ内のnative easingを会話画面のentryにも利用します。`FluentDialog` / `MenuFlyout` の内部entry/exitを外側で置き換えず、popup内容の実際のdisposeを観測して終了処理を行います。Fluent v0.1.0にdismiss-finished callbackがない箇所へ固定時間の推測待ちを追加していません。

これはCompose Fluentのアプリ内materialです。Windows DWMによるOSウィンドウMicaと同一の実装をWebへ移植したという意味ではありません。既存のnavigation popup回避策も、今回再現検証できていないため勝手には削除していません。

### Miuix

native Cardの初期値 `PressFeedbackType.None` で無効だったプロフィール／会話カードのpressを `Sink` + indicationへ変更しました。reduced-motion時は移動を抑えます。

native `Scaffold` のpopup hostを導入し、メニューは `OverlayBottomSheet`、編集／取り消し確認は `OverlayDialog` を使用します。spring、drag、nested scroll、scrim、closeの処理はライブラリへ委譲します。ヘッダー／入力欄には実 `miuix-blur.textureBlur` を接続し、スクロールやfocusに応じたblur半径をnative `folmeSpring` で遷移させます。

### 共通の状態・描画

`commonMain/kotlin/MotionState.kt` に閉じる→次のpanelを開くための小さな状態型を追加。business actionはここへ移していません。

`ThemeMotion.kt` は画面ID／account epoch／pane IDなどをキーにし、入力や既読更新のたびにnavigationを再始動しません。画面全体を二重にcomposeせず、単一の入力欄・history・mediaを移動します。HTML mediaの位置も追従させるため、canvasだけのtransform/fadeではなくlayout offsetを選んでいます。これはWebでエフェクトが動かないと判断したfallbackではありません。

ホストメニューはclose中も表示内容を保持し、背後のHTMLメディア遮蔽も終了まで保ちます。close中のコマンドを無効化。account/theme切替時は以前の表示内容を破棄します。

Backdrop captureはApple／Miuixの各可視timelineに限定し、すべてのメッセージへshaderを付けていません。これらは構造上の対策であり、今回FPSやGPU時間を測定できたという意味ではありません。

## 調べたソース

- 添付AndroidLiquidGlass `65ab177e90e5c1d8c62e70cf7755841982da65f6`: `app/src/commonMain/.../catalog/components/LiquidButton.kt`, `LiquidBottomTabs.kt`, `LiquidBottomTab.kt`、gesture/animation utilities、`backdrop/src/skikoMain/.../RuntimeShader.kt`。
- 添付Shapes `032af02e0ee88bd050d77997f25dd8adc2c49e1d`: `RoundedRectangle`、continuous corner関連の実装と既存利用箇所。
- 添付MiuixのHEADはconsumerより新しいため、同梱Gitの `v0.9.3` (`c36fab72391801d1e3ea5a00f966bf16bac28d4c`) を別展開して確認。`Card`、press utilities、`folmeSpring`、`OverlayBottomSheet`、`OverlayDialog`、各ContentLayout、`Scaffold`、miuix-blurのcommonMain/skikoMain/wasmターゲット、exampleのsheet/dialog/blur。
- **添付 `fluent/` は `projectfluent/fluent`（localization）で、Compose Fluentではありません。** 不足分だけ公式 `compose-fluent/compose-fluent-ui` の `v0.1.0` を参照。`FluentTheme.kt`, `animation/FluentEasing.kt`, `component/NavigationView.kt`, `MenuFlyout.kt`, `Flyout.kt`, `Dialog.kt`, `background/Material.kt`, `webMain/.../Dialog.web.kt`, `gallery/.../screen/menus/MenuFlyoutScreen.kt` を確認。Web/wasm/skikoのsource-set構成も確認しました。
- 添付iMessage画像は画面・メニューの視覚参照として確認。今回、新旧レンダラーを並べるpixel比較は実施できていません。

source-setやSkia実装が存在することは、今回の依存組合せで全shaderがブラウザ動作する証明ではありません。

## 今回実行した検証

| 検証 | 結果 | 意味・制限 |
| --- | --- | --- |
| 純Kotlin状態テスト | PASS、364状態系列 | 実際のcommonMain状態型をKotlin CLI 1.9.0でコンパイル・実行。Composeは含まない |
| Kotlin PSI構文検査 | PASS、30ファイル、構文エラー0 | 型解決・Compose compiler・Wasm backendは実行していない |
| native接続の静的チェック | PASS、14項目 | 呼び出し・設定の存在確認。描画確認ではない |
| 変更JSのsyntax check | PASS | browser suite本体は起動未到達 |
| bridge境界・action名差分 | PASS | Bridge.kt / compose-contract.ts / kmp-app-host.tsx は変更なし。全feature parityの証明ではない |
| `git diff --check` | PASS | 差分の空白エラーなし |
| `compileKotlinWasmJs` | BLOCKED | `services.gradle.org` DNS失敗。Gradle配布取得前後の段階で停止し、project compile未実行 |
| development distribution | BLOCKED | 同上 |
| production distribution | BLOCKED | 同上 |
| frontend production build | BLOCKED | `bun: not found`。frontendビルド未実行 |
| `smoke.mjs --production --chat --motion` | BLOCKED | `@playwright/test` が未導入（MODULE_NOT_FOUND）。native browser test未開始 |
| 別のChromium startup診断 | BLOCKED | Chromium自体は起動。loopbackページへのnavigateが `net::ERR_BLOCKED_BY_ADMINISTRATOR`。UIは一度も起動していない |

配布ZIPの `verification/` に実行ログとJSONを添付しています。Gradle/DNSやブラウザ起動制限を、Wasm非対応の根拠として扱っていません。今回の変更では、Webという理由のエフェクトfallbackは追加していません。

## 追加した実ブラウザ用テスト（今回未実行）

`smoke.mjs --chat --motion` は、ビルド済みの実Wasmレンダラーへ既存の隔離bridge fixtureを渡します。単なるCSS画面やスタブUIを撮影するテストではありません。fixtureのみで、LINEアカウントや本番backendへ接続しません。

3テーマ × 幅390/1280 × light/darkについて、実pointerのhover/press/cancel、press中の時系列画像、nativeメニュー→編集dialog、native階層メニューから元のcommand IDへの到達、close途中／終了、単一composer/history、reduced-motion時のroute位置を検査するコードを追加しました。**テストケースが存在することと、合格したことは別です。**

アニメーション時系列の追加記録先は `dist/gradle/browser-smoke/motion/`。既存の `--regressions` とApple用 `apps/desktop/scripts/check-apple-liquid-motion.ts` は維持しています。新suiteのlocatorやnative Popupのsemanticsも実行して調整する必要があります。

## 未完了・要確認

今回のproduction artifactは生成できていません。依存解決とCompose/Wasmの型/API互換性が最初の未確認項目です。特に追加した `miuix-blur:0.9.3` の解決、Compose Fluent popupのfocus／semantics、Skia shader、popup完了通知、HTML mediaとnavigationの位置追従、narrow画面のsheetを実ブラウザで確認する必要があります。

新しいroute motionは単一画面のentryです。全テーマの完全なinteractive back gestureや全ページのOS遷移を実装したものではありません。native各コントロールまで含めたreduced-motion、全surfaceのOS一致、全機能のend-to-end parity、モバイル実機、高DPI、長い履歴でのFPS／メモリ／GPU負荷、実データ送受信は未検証です。既存のadvanced settings/call/rich media等のcompatibility surfacesは残しています。

## 再実行コマンド

依存関係を導入済みの元Vyline checkoutへ差分を適用して実行します。PowerShellの場合:

```powershell
# Vyline/apps/compose-ui から
node scripts/check-theme-motion-source.mjs
.\gradlew.bat --no-daemon compileKotlinWasmJs
.\gradlew.bat --no-daemon wasmJsBrowserDevelopmentExecutableDistribution
node scripts/smoke.mjs --chat --motion --regressions
.\gradlew.bat --no-daemon wasmJsBrowserDistribution
node scripts/smoke.mjs --production --chat --motion --regressions
# frontendへのコピーを含む既存productionビルド
Set-Location ../desktop
bun run build
```

`@playwright/test` は既存desktop workspaceの依存を使用します。PlaywrightのChromiumが導入済みであることが必要です。利用可能な既設Chromiumを使う場合は `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` に絶対パスを指定できます。制限された実行環境のポリシーを変更するスクリプトは含めていません。
