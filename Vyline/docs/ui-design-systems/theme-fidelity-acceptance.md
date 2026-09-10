# Compose theme fidelity — acceptance checklist

更新: 2026-09-10 · 状態: **主要な配色・状態保持修正、開発版6条件、本番版の対象回帰・モバイル確認は成功。全機能・参照画像への網羅的視覚受入は未完了。**

承認済みCompose fidelity repairの受入条件。対象は Messages (`apple`)、Fluent (`fluent`)、Miuix (`miuix`) の light / dark。既存Vylineの機能・情報・操作を残し、各デザインシステムの外観へ合わせる。参照アプリにない機能を削除して見た目だけを合わせない。

この文書のチェックボックスは、当該修正の実行結果とレビュー証跡が揃うまで未チェックのままにする。過去の監査成功、ソース上の接続、今回追加したテストの存在は今回のPASSではない。

## 範囲と根拠

- [機能inventory](feature-inventory.md): 元の機能一覧。記載の行番号と制限は当時のbaselineに属する。
- [操作監査](interaction-audit.md): accountless demoで確認した操作、controller/API接続、実通信・実機で残る確認を区別する。
- [実装境界](README.md): 認証・同期・送信・録音は既存controllerの責務。Composeは表示と操作の接続を担当する。
- [既存検証記録](verification.md): 過去の実行結果。今回のbundleや修正の合格を意味しない。
- 新規補助スクリプト: `apps/desktop/scripts/check-theme-fidelity.ts`。既存chat/parity/settings-layoutチェックの置換・緩和ではない。

## 安全条件と実行方法

- [ ] 新規の隔離ブラウザcontextで、localhostの `/pr-demo` のみを使った。
- [ ] すべての共有store読み取りで `demoMode === true`、`accountId === null` を確認した。
- [ ] 実アカウント・token・認証store・LINE API・実送信先・実録音を使っていない。
- [ ] リモート通信と `/api/` をブラウザで遮断し、明示fixture以外のAPI・外部リクエスト試行がないことを確認した。既知のリアクション画像1 URLだけを合成SVGに、host Google Fonts stylesheet 1 URLだけをoffline CSSに置換し、別配列に記録する。Composeの同一originフォントは変更しない。
- [ ] destructive操作は存在・到達性の確認まで。削除、初期化、reload、ログアウト、復元を実行していない。

以下は承認済み実装の検証コマンド。既に用意されたローカルViteサーバーと、それが配信する修正済みCompose bundle、Bun、Playwright、Chromeが必要。スクリプト自体はサーバーを起動しない。実際にロードされた `/src/lib/store.ts` を読み取るため、production previewには対応しない。未検出なら失敗させ、別storeを作って代用しない。

Git Bash / POSIX shell、repository rootから実行する例。

```sh
VYLINE_TEST_URL=http://127.0.0.1:5173 \
  bun Vyline/apps/desktop/scripts/check-theme-fidelity.ts
```

PowerShellの場合。

```powershell
$env:VYLINE_TEST_URL = 'http://127.0.0.1:5173'
bun Vyline/apps/desktop/scripts/check-theme-fidelity.ts
```

`VYLINE_TEST_URL` はパス・query・認証情報を含まないローカルorigin。出力先の既定値は `apps/desktop/test-results/theme-fidelity/<timestamp>/`。必要なら `VYLINE_TEST_OUTPUT` を指定できる（相対値はスクリプトのディレクトリ基準）。成功・失敗とも `results.json` を残す。途中失敗ではケース名付きPNG、stage、例外、native accessibility snapshotも残す。実行を続けて失敗を成功扱いにしたり、未検証ケースをPASSとして埋めたりしない。

## 自動回帰ゲート

六条件を一つの継続ページで順に操作する。modeとappearanceを変更するためにstore setter、iframe再生成、ページreloadは使わない。

| 条件 | Desktop 1440×1000 / DPR2 | Phone 390×844 / DPR2 | スクリーンショットレビュー |
| --- | --- | --- | --- |
| Messages light | [x] | [x] | [ ] |
| Messages dark | [x] | [x] | [ ] |
| Fluent light | [x] | [x] | [ ] |
| Fluent dark | [x] | [x] | [ ] |
| Miuix light | [x] | [x] | [ ] |
| Miuix dark | [x] | [x] | [ ] |

各条件の共通チェック。

- [ ] DOM鏡の人工的な `.click()` ではなく、安定したnative semantic boundsへ実ポインタを送った。
- [ ] 日本語2行の未送信draftが、設定への往復、テーマ切替、appearance切替、resize後も一致する。
- [ ] 選択中のトーク `demo-chat-team` と返信先 `demo-message-4` が保持される。
- [ ] メッセージ総数が変わらず、draftが誤送信されない。
- [ ] 常設host composerとiframe **要素**が保持され、iframe **document**も同一。追加navigation/reloadとiframeの増殖がない。
- [ ] `data-ui-mode` と `data-appearance` が選択した値になる。これだけでCanvasの配色を合格にしない。
- [ ] 代表メッセージの時刻がnative意味情報に存在する。時刻は既存storeのformat結果と照合する。
- [ ] `既読者一覧 2人` を開き、あおい・れんの名前と取得済み既読時刻を確認し、Escapeで閉じられる。
- [ ] メッセージ操作に返信・コピー・編集・送信取消・詳細・6種類のリアクションが残る。
- [ ] `いいね` を付け、`いいね 1件` を表示し、再クリックで解除できる。共有storeのreaction数も一致する。
- [ ] phoneで入力欄と末尾既読ボタンがviewport内に収まり、重ならず、documentの横溢れがない。
- [ ] JavaScriptの実行時例外がなく、明示fixture以外のAPI・外部リクエスト試行がない。

**「selection」の自動確認範囲:** 選択トーク、返信先、および実キー入力で作ったcomposerの前方向4文字選択。設定・mode・appearance・resize後、読み取り専用の既存composer snapshotでselectionStart/selectionEndを照合する。これはhost側の範囲保持の検査であり、再生成されたCanvas text fieldの選択ハイライト/次の置換入力までの完全な証明ではない。Canvasでの復帰後入力、逆方向選択（host bridgeは順方向へ正規化）、複数メッセージ選択、IME変換中の範囲保持は別途未検証とする。

**Compose Webの注意:** 古い監査ではselected/stateDescription/disabledのAX反映とclick callback、座標更新に制約がある。更新されたnative panelと旧来のchat/settingsも同一視しない。CSS/AXの色やcheckedだけでCanvasの描画・選択状態を証明しない。代表時刻に架空の `送信日時` ボタンlocatorを作らない。

## 視覚的fidelityの手動受入

自動scriptはPNG evidenceを生成するが、golden画像比較や参照とのpixel一致を判定しない。`desktop-chat`、`phone-chat`、`readers`、`message-menu`、`reaction`、`settings`、`settings-cache`、`settings-reset` を各mode/appearanceで比較する。

- [ ] Messages: 明暗の階層、glassの透明感・境界、連続曲率、symbol、ヘッダーと一覧の配置が参照意図と一致する。glassで時刻・本文の可読性を損なわない。
- [ ] Fluent: Mica背景が不透明な共通surfaceで隠れない。navigation/list/field/buttonの寸法・階層・状態表現がFluentとして一貫する。
- [ ] Miuix: top app bar、card、navigation、field、switchの構成と余白がMiuixとして一貫し、別テーマの部品が混入しない。
- [ ] 3テーマとも単なる同形状の色替えになっていない。共通の機能を持ちつつ、それぞれの情報階層・密度・角丸を保つ。
- [ ] 本文・時刻・送信状態・既読数・リアクション・返信表示・選択行のコントラストをlight/dark双方で確認した。
- [ ] 長い日本語、長いトーク名、未読badge、複数行プレビュー、絵文字、狭幅でも重要情報が切れず、操作面が重ならない。
- [ ] native settingsのtoggle、radio、slider、destructive affordanceが正しい状態・色・形状で表示される。
- [ ] focus、pressed、hover、disabled、reduced motionを必要な入力方式で確認した。静止PNGだけで操作/動作を合格にしない。
- [ ] 狭幅settings、keyboardによるviewport縮小、320/375/768/1024pxなど新規script以外の境界幅も既存suiteまたは追加の手動証跡で確認した。

## 設定・destructive controlの受入

account nullでも表示できる設定の到達性だけを補助scriptで確認し、accountを合成して範囲を水増ししない。

- [ ] nativeの `アカウント・バックアップ・詳細設定` から実際の詳細設定へ入れる。
- [ ] `詳細・復元` の `キャッシュを削除して再読み込み` がnative操作面に存在し、画面内に収まる。クリックしない。
- [ ] `設定を初期化` の説明と `初期化` 操作が維持される。表示位置によってscrollが必要。実行しない。
- [ ] destructive confirmationの文言、cancel、Escape、focus復帰を別の安全なテストで確認した。表示確認から削除の成功を推測しない。
- [ ] backup削除・端末削除/ブロック・ログ削除・カテゴリ別media/cache削除について、item/categoryを特定した範囲で確認した。重複する `削除` の最初の一つを押すテストにしない。
- [ ] saved VyTheme、appearance、animation、font size、background、densityなどの保存/適用/復元を確認した。
- [ ] Classic/NezuUIとの往復でも保存VyThemeを上書きせず、draft/添付/録音の状態を保つ。

## 機能inventory — この補助scriptのPASSに含めない項目

以下は機能を削ってよい一覧ではない。既存の機能を残し、適切な既存suite・実機・実通信確認を別途要求する。未実装/制約と未検証を分ける。

### 現在の既知の欠落・制約

- [ ] Compose Webのscreen readerへの状態・disabled・selectionの完全な反映。
- [ ] 任意document/file添付送信（受信fileの表示/downloadと画像・動画送信は別）。
- [ ] typing indicator。
- [ ] sidebar行のswipe操作（long-press/context menuは別）。
- [ ] lightboxの専用gallery移動/zoom controls。
- [ ] 未cacheの古い返信先・announcementへの確実なfetch付きjump。
- [ ] 共有React message context menuの完全なroving矢印キー操作（native readers modalのキー操作とは別）。

inventory baselineにある「enterToSend未使用」は現在の欠落として転記しない。現行composerは設定を読む。desktop Enter/Shift+Enter、mobile newline、実IME変換の安全性はそれぞれ別検証する。

### 既存機能の広い回帰 — 今回は未検証

- [ ] 送信・複数行・Enter設定・mention・sticon・emoji・添付選択/削除・録音/取消・reply jump。
- [ ] edit/history・retry・revoke/restore・clipboard/部分copy・search・announcement・古い履歴取得/位置保持。
- [ ] 画像/video/audio/sticker・組合せ・Flex/Rich・contact/location/file/call eventの内容、詳細、download、clip、seek/volume。
- [ ] トーク一覧の検索/並べ替え/未読/pin/lock・2〜4pane・chat/accountをまたぐ入力分離・選択範囲保持。
- [ ] member/profile/group/chat management・plusメニュー・ノート/アルバム/eventの到達性とdisabled理由。
- [ ] 詳細設定の全カテゴリ・非destructive変更・settings持続性・Classic/NezuUIの同等回帰。

### 実通信・実機 — demoで代替しない

- [ ] 実LINEのtext/media/sticker/combination送信、muted送信、通知なし取消、restore、read更新。
- [ ] 実login/account切替/logout・同期/再接続・profile更新・group作成/招待/退出/block。
- [ ] 実microphone/録音送信・OS日本語IME・Safari/Android実機・物理haptics。
- [ ] 実通話/WebRTC・着信・録画/録音保存。ローカルcall fixtureの表示成功とは別。
- [ ] backup作成/復元/削除・device pairing/削除/block・cache/media/logの実削除・handoff/proxy。
- [ ] plusメニュー内部API、clipboard/downloadの実環境完了、全advanced settingの保存と適用。

## 証跡と合否記録

### 2026-09-10 中間結果（最終合格ではない）

- 開発Compose: Git Bashの `bash Vyline/apps/compose-ui/gradlew -p Vyline/apps/compose-ui wasmJsBrowserDevelopmentExecutableDistribution --console=plain` 成功。`build.mjs --development --copy-only` で配置。標準build launcherはこのWindows環境で `gradlew.bat` の解決前に失敗するため回避した。
- `bun test Vyline/apps/desktop/src`: **143 pass / 0 fail**、31ファイル。証跡: `apps/desktop/test-results/theme-desktop-unit.log`。
- Desktopおよびroot全workspace `typecheck`: **exit 0**。root証跡: `apps/desktop/test-results/theme-full-typecheck.log`。
- Compose `smoke.mjs --chat --motion --regressions`: **exit 0**。3テーマの返信/mention keyboard、live menu更新、account isolation、locked-chat controls。解決済み色のselftestも実行。証跡: `apps/compose-ui/dist/gradle/browser-smoke/dev-1789038021084/`。
- Compose `smoke.mjs --chat --mobile`: **exit 0**。3テーマのtouch、模擬IME focus、resize/anchor、fixture送受信、call/menu。証跡: `apps/compose-ui/dist/gradle/browser-smoke/dev-1789038240287/`。物理IME・実通話・実LINEの証明ではない。これらはAppleLiquidTabsの後続foreground修正前のbundle。
- `check-native-settings-layout.ts`: **3テーマ成功**。1920×1000、390×1000、390×480のメニュー境界、設定の到達性。証跡: `apps/desktop/test-results/native-settings-layout-1789037117719/`。後続のstable-host/contrast変更より前のbundleの結果なので、最終再実行が必要。
- `check-kmp-chat.ts`: **3テーマで2回連続成功**。Miuixの失敗は返信シートの終了前にcomposerをクリックするtest race。シート実disposalと正のAX geometryを待つよう修正し、実filechooser/添付削除、複数行入力とlocal送信、返信、dark/Classic切替のdraft保持、保存外観の再読み込み復元、390/768/1024/1440幅を確認。API試行0、page error0。証跡: `apps/desktop/test-results/kmp-chat-diagnosis-repeat/results.json`。任意のGoogle Fonts stylesheetは遮断され、host font再現の検証には含めない。
- root `bun run lint`: **exit 0**。一時診断scriptの文字列結合2箇所を修正して再実行。
- `check-theme-fidelity.ts`: 連続キーのframe同期とCompose blur時のsynthetic collapse抑止後、Apple lightの4文字選択はreaders/reaction/settings後も保持。resize時は保持されたhistory anchorから実際の「最新のメッセージへ」で末尾へ移動して検査する。**6条件すべて成功（exit 0）**。証跡: `apps/desktop/test-results/theme-fidelity/1789038734624/results.json`。1440/390px、draft/前方向4文字選択/reply、iframe要素・document同一性、既読時刻、reaction toggle、advanced設定のcache/reset到達性を確認。既知CDN画像1件/host font stylesheetを明示fixtureに限定し、想定外API/外部試行0、page error0、frame navigation0。
- `check-controller-media.ts`: **exit 0**。合成canvas streamのvideoが3テーマ/Classic往復で同一、attach 1/detach 0。証跡: `apps/desktop/test-results/controller-media/1789038669195/`。実カメラ・WebRTC・二者通話ではない。
- テーマrootを安定したprovider/Scaffold位置に変更し、account epochでのみ内容をリセットする。modalのmode変更時focus復帰を追加。上記6条件とcontroller media保持は成功。ただし全modal/viewer状態の網羅的検証ではない。
- 最終IME cleanup（blur時にcompositionのみ終了しselectionは保持）後の開発再検証: `check-theme-fidelity.ts` **6条件成功**、証跡 `apps/desktop/test-results/theme-fidelity/1789039175035/`。`smoke.mjs --chat --mobile` **3テーマ成功**、証跡 `apps/compose-ui/dist/gradle/browser-smoke/dev-1789039192900/`。
- settings layout再実行: **3テーマ成功**、証跡 `apps/desktop/test-results/native-settings-layout/1789039076675/`。実行開始がIME cleanup bundle配置前なので、各ケースが同一最終bundleを読んだとは断定しない。
- IME cleanup後の本番Compose: Git Bash wrapperの `wasmJsBrowserDistribution` **exit 0 / 5m25s**。app Wasm識別子 `087d86f1639440aca834.wasm`。`smoke.mjs --production --chat --mobile` **3テーマ成功**、証跡 `apps/compose-ui/dist/gradle/browser-smoke/prod-1789039626559/`。
- 本番 `smoke.mjs --production --chat --motion --regressions`: **exit 1**。Apple account isolation成功後のlocked-chat control待機が10秒timeout。証跡 `apps/compose-ui/dist/gradle/browser-smoke/prod-1789039626464/`。原因調査中でありPASSに含めない。
- root `bun run build`: **exit 1**、このWindows環境で `gradlew.bat` を解決できず停止。証跡 `apps/desktop/test-results/theme-root-build.log`。Git BashからのCompose成功を標準launcherの成功と混同しない。
- 画像レビューでMiuix dark message menuの本文・danger色に適用漏れを発見。`1789039175035/miuix-dark-message-menu.png`。原因はScaffold bodyの外にあるoverlay hostへrenderer localsが届かず、Apple light fallbackを読んでいたこと。native provider内でlocalsをScaffoldより上へ移した。安定したScaffoldとaccount epoch keyを維持。修正後の再描画確認は継続中。
- 同runの3テーマ×light/dark、desktop-chat/phone-chat **12枚を実画像レビュー**。明確なclipping・重なり・読めない本文・別テーマ混入は指摘なし。参照画像へのfidelity、全コントラスト、settings/message-menu全画像の合格とは別。
- TypeScript `tsc -b` とVite production buildをdesktop working directoryで個別実行し **exit 0**。証跡 `apps/desktop/test-results/theme-vite-build-cwd.log`。root cwdからViteを呼んだ先行試行はTailwind content未検出の警告があり、受入には採用しない。最終Compose修正前のpublic assetsを含むため配布物の最終受入ではない。
- コントラスト監査で小文字の不適切なaccent/selection/danger組合せを確認し、foreground/fill分離と専用danger面を追加。Miuix 0.9.3既定primary Buttonの白文字は3.63:1 light / 4.03:1 darkという上流既定の制限があり、全UIのAA準拠を主張しない。glassの全backdrop合成も未検証。

### Overlay provider修正後の確認

- 開発Compose再build **exit 0 / 20s**。app Wasm `b6a3574ba8dcfaad6cc7.wasm`。
- `check-theme-fidelity.ts` **6条件成功 / exit 0**。証跡 `apps/desktop/test-results/theme-fidelity/1789039978943/`。Miuix dark message-menuの実PNGで本文・時刻・danger文字の適用漏れ解消を確認。これは全スクリーンの参照fidelity受入ではない。
- `check-native-settings-layout.ts` **3テーマ成功 / exit 0**。証跡 `apps/desktop/test-results/native-settings-layout/1789039997415/`。
- `check-controller-media.ts` **exit 0**。証跡 `apps/desktop/test-results/controller-media/1789039997440/`。native/Classic往復で同一合成video/stream保持。
- 最終root lint/typecheck **exit 0**。証跡 `apps/desktop/test-results/theme-lint-final.log`、`theme-typecheck-final.log`。lint先行失敗は今回生成したminified Vite成果物をtest-resultsから拾ったため。成果物を既存ignore対象の `apps/desktop/dist/theme-fidelity-build-{root,cwd}/` に移し、ソースルールを弱めず再実行。
- Overlay修正後の本番Compose最適化 **exit 0 / 5m37s**。app Wasm `f50e1311d2fb214523bf.wasm`。本番mobile smoke **3テーマ成功 / exit 0**、証跡 `apps/compose-ui/dist/gradle/browser-smoke/prod-1789040345199/`。開発mobileも同じ修正で成功、証跡 `apps/compose-ui/dist/gradle/browser-smoke/dev-1789040244535/`。
- 最終unit **143 pass / 0 fail / 31 files**、証跡 `apps/desktop/test-results/theme-unit-final.log`。
- 本番Composeを `build.mjs --copy-only` で配置後、desktop cwdで `tsc -b` と `vite build --outDir dist/theme-fidelity-final` が **exit 0**。証跡 `apps/desktop/test-results/theme-production-final.log`。標準launcherのWindows失敗は未修正。bundle sizeとGradle hierarchy/deprecation警告は残る。
- 修正後6枚のmessage-menu PNGをレビューし、明確なclipping・読めない前景・操作を隠す重なりは指摘なし。Miuixの6番目のreactionは2行目へ折り返し、閉じる操作も画面内。参照fidelity全体・全状態のAA合格とは別。
- 本番desktop回帰のlocked-chat timeoutはテスト同期不備と確認。locked→blockedでpanel終了を待たず再表示し、すでに不在のeditorをready条件にしていた。ケース固有の制限文言・panel消失/再表示・visible/enabledを待ち、実ポインタからの `close-details` と対象actionをepoch/chat scope込みで照合するよう修正。timeout延長・固定sleep・click retry・assertion削除はしていない。`smoke.mjs --production --chat --motion --regressions` **exit 0**、3テーマ成功。証跡 `apps/compose-ui/dist/gradle/browser-smoke/prod-1789040250706/`。このrun開始は最終production再build終了前のため、全ケースが最終Wasmを読んだとの保証には使わない。

- 実行日/担当: **2026-09-10 / Claude Code**
- 対象: baseline `92d4a077570d28adef7ca54c9ed3aef93638dfc6` に対する未コミットの `fix/compose-theme-fidelity`。最終production app Wasm `f50e1311d2fb214523bf.wasm`。Vite `http://127.0.0.1:5186`、Chrome `152.0.7977.83`。
- コマンド・exit code・証跡path: 上記の各実行記録を参照。最終bundleのみの `smoke.mjs --production --chat --motion --regressions` 再実行 **exit 0 / 3テーマ成功**。Apple locked/blocked両状態のsearch/menu、全テーマのreply/mention keyboard・live menu更新・account isolationを確認。証跡 `apps/compose-ui/dist/gradle/browser-smoke/prod-1789040529866/`、`apps/desktop/test-results/theme-production-regression-final.log`。続けてroot lintと `git diff --check` も **exit 0**。
- 6条件のPNG: `1789039978943/`。Claude Codeによる代表chat/menu画像レビュー済み。ユーザー添付参照との全画面比較・残りsettings等の網羅的視覚受入は未完了。
- 既存suite再実行結果と範囲: 上記参照。実通信・実機と全機能inventoryは未検証項目を維持。
- 残る制約、未検証項目、例外を受け入れる責任者: **未記入**

**合格条件:** 自動gate成功に加え、fidelityの手動レビューと必要な既存回帰の証跡が揃い、未検証/制約が明記されていること。デモのみの成功を「全機能完成」「実LINE合格」と報告しない。
