# Compose theme fidelity — acceptance checklist

更新: 2026-09-10 · 状態: **主要な配色・状態保持修正、開発版6条件、本番版の対象回帰・モバイル確認は成功。全機能・参照画像への網羅的視覚受入は未完了。**

承認済みCompose fidelity repairの受入条件。対象は iMessage (`apple`)、Fluent (`fluent`)、Miuix (`miuix`) の light / dark。既存Vylineの機能・情報・操作を残し、各デザインシステムの外観へ合わせる。参照アプリにない機能を削除して見た目だけを合わせない。

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

### 2026-09-10 追加依頼 — iMessage名称と通話確認（作業中）

以下はbaseline `d0c0452` 後の追加修正。以前の成功をスクロール・Flex/Rich・分割プレビューの修正証明には使わない。

- 表示名を **iMessage** に変更。内部ID `apple` と保存形式は維持。表示名unitは変更前に失敗、変更後 **3 pass / 0 fail**。`check-theme-fidelity.ts` は **6条件成功 / exit 0**、証跡 `apps/desktop/test-results/theme-fidelity/1789048915657/`。Apple light設定PNGでiMessage表示を確認。
- 通話確認は既存controller promiseを拡張し、タイトル・発信文言・初期キャンセルfocusをnative表示へ渡す。Appleは既存AndroidLiquidGlass (`backdrop:2.0.1`) のblur/lensを使用し、Fluent/Miuixは既存native dialogを維持。
- **RED:** `check-controller-confirmation.ts` の合成動画＋確認でApple lightが `memory access out of bounds`。証跡 `apps/desktop/test-results/controller-confirmation/1789049539547/` と `1789049616216/`（後者はstack付き）。失敗は削除・skipしていない。
- 原因として、rootの `menuBackdrop` capture内に同じbackdropを読むdocked callボタンが存在する循環を特定。通話画面は不透明なcanvas色なので、全call commandが独立した `rememberCanvasBackdrop` を使うよう変更し、root captureへの依存を除去。
- **GREEN:** development Compose build＋copy **exit 0 / 15s**、app Wasm `f35c3ada487efb64d4e4.wasm`。同じ確認scriptが **3テーマ×light/darkの6条件成功 / exit 0**。証跡 `apps/desktop/test-results/controller-confirmation/1789050114277/results.json`。初期Enter取消、pointer承認1回、Escape、Tab 20回／Shift+Tab 19回とEnter、Apple外側取消、タイトル/AX、動画HTML遮蔽と復帰、iframe要素/document保持を確認。page error・想定外通信・device取得・call requestは0。
- 上記はaccountless `/pr-demo` からpublic controller確認を呼び、既存presentation-only call fixtureを表示した検証。実際の右上call actionからbackendへ至る統合、実動画再生、実通話、実カメラ、phone、最適化productionの成功を意味しない。
- Apple light/darkの動画遮蔽PNGとApple light復帰PNG、Fluent dark確認PNG、Miuix light確認／dark動画遮蔽PNGを実画像レビュー。確認文言・ボタンは画面内で読め、遮蔽中は動画が前面に出ず、閉じた後に合成の待機映像領域が復帰する。参照とのpixel一致・全背景でのcontrast合格ではない。
- desktop unit **194 pass / 0 fail / 33 files**、workspace typecheck **exit 0**。lint初回は新規scriptの複数変数宣言等7件で **exit 1**。宣言を分離し、禁止constructor呼出記録のため必要な通常functionには理由付きの局所注記を追加。
- lint修正後、root `bun run lint` と `git diff --check` **exit 0**。最適化Compose `wasmJsBrowserDistribution` **exit 0 / 5m23s**、app Wasm `66b40fd1b4d7df0c2244.wasm`（この時点では未配置・未実行）。
- phone幅390×844の確認scriptは **exit 1** が2回。証跡 `apps/desktop/test-results/controller-confirmation/1789050512902/` と `1789050699567/`。後者の診断は `navigation.type: reload`、確認audit消失を記録し、Vite logには並行したtest編集によるpage reloadがある。安定した編集終了後の再実行を要する。新規scriptは以後のhost/Compose frame navigationを明示failureとして記録する。
- 通話gateのレビューで、scope失効時に古いdialogが残ること、空pane IDsの既存単一chat fallbackを拒否することを確認。8件のRED回帰後、IDに紐付くAbortSignal取消／全解決でlistener cleanup／有効pane fallbackと元pane表現の検証を追加。修正後desktop unit **213 pass / 0 fail / 33 files**、workspace typecheck、lint、diff checkは **exit 0**。
- 編集終了後のphone再実行 `1789050950800/` は動画遮蔽時に確認が全画面通話Popupの背後へ隠れて **exit 1**。auditはpending、navigationは初回navigateのみ、page error0。AppのApple foreground判定へ全画面callを含め、development build **exit 0 / 22s**。`1789051099154/` のPNGで確認の前面表示を実画像確認。ただしhost `[role=dialog]:visible` 1件検出でテストはまだ失敗。
- その1件はphoneで `role=dialog` になる既存の画面外call controller。Playwrightの `:visible` はopacity0／画面外／inertを除外しない。候補全件について特定fixtureのcall panelであること、ownerのaria-hidden/inert/opacity0/pointer-events:none、ownerとpanelの画面外境界を実測し、native modal top-layerは0件とする検査へ修正。無条件除外や許容countの引上げではない。
- phone390×844 **6条件成功 / exit 0**、証跡 `apps/desktop/test-results/controller-confirmation/1789051355896/`。desktop1440×1000もlifecycle/layering変更後 **6条件成功**、証跡 `1789051115226/`（host containment assertion変更前）。前面のnative表示・初期取消・cycle・動画遮蔽復帰・runtime保持を確認。実機touch/IMEではない。
- 最適化bundle `66b40fd1b4d7df0c2244.wasm` の `smoke.mjs --production --chat --motion --regressions` **exit 0 / 3テーマ成功**、証跡 `apps/compose-ui/dist/gradle/browser-smoke/prod-1789050905189/`。このproductionは後続のforeground layering修正前であり、最終production受入として流用しない。
- Browser paneのaccountless demoでも実controller確認を表示して描画を確認、Escapeを送信。viewport emulationはdesktopへ復帰。
- **Focus RED:** 直前のnative muteを実pointerで操作→確認→Escape→Enterの回帰を追加すると、Miuix lightの全画面phoneでmuteが再操作されず失敗。証跡 `apps/desktop/test-results/controller-confirmation/1789051680852/`。root contentへの無条件focus復帰を廃し、実際にfocusを持っていたcontent/foregroundの保存済み子のみを復帰対象にした。scope/epoch/mode/foreground identityやlayoutが変われば古い復帰は無効化する。
- **Focus GREEN:** development build＋copy成功、app Wasm `2b0141d8b123668368b5.wasm`。phone-expanded **6条件成功** `apps/desktop/test-results/controller-confirmation/1789052141805/`、desktop-docked **6条件成功** `1789052276121/`。全12条件で直前muteへEnterで戻れることと既存confirmation/動画遮蔽/runtime保持assertionが成功。実通話・device/APIは使わず、既存presentation fixtureのlocal mute stateを検査。
- **最適化Focus GREEN:** `wasmJsBrowserDistribution` **exit 0 / 5m19s**、copy後のapp Wasm `d9f91ea4284bc4ac81ce.wasm`。desktop-docked `apps/desktop/test-results/controller-confirmation/1789052993048/`、phone-expanded `1789053145678/` が各 **6条件成功 / exit 0**。最適化Composeをdevelopment Viteから配信したcontroller統合検証であり、desktop全体production buildとは区別する。Apple dark desktop／light phoneの動画遮蔽PNGを開き、確認が前面で読めて動画HTMLが重ならないことを確認。最終focus変更後のlint／diff checkも成功。
- **残る通話slice検証:** scope変更／起点control消失・disabled時のfocus復帰は実装でguardするが個別browser回帰は未実施。実アカウントのhost call actionからbackendまでを通す検証は未実施で、demoの成功を実通話成功としない。
- **Scroll RED:** selftest限定の数値計測（epoch/chat/pane/generation、最終行key/offset/size、実padding/viewport、canScrollForward）と長文／遅延画像fixtureを追加。スクロール本体未変更のdevelopment build **exit 0 / 23s**、app Wasm `975633023e8f7716eddc.wasm`。`VYLINE_TRUE_BOTTOM_ONLY=1 node apps/compose-ui/scripts/smoke.mjs --chat --mobile` は **exit 1**、証跡 `apps/compose-ui/dist/gradle/browser-smoke/dev-1789053390342/mobile/apple/true-bottom.json`。短文の初期末尾は成功、65行の最終メッセージは末端+paddingが1684pxに対しviewport端599px、遅延portrait画像は1519pxに対し599pxで、どちらも `canScrollForward:true`。独立resetした2ケースが実際のサイズ測定後に失敗。他テーマはrunnerのfail-fastにより未実行。再mountで各ケースを独立させた再実行 `dev-1789053584429/` でも同じ2件が失敗し、追加した「履歴閲覧後のauthor=me置換」も末尾へ位置を奪われて失敗。空→ロードの短文ケースは成功。2つのRED PNGを実画像確認し、長文末尾／画像下端がcomposerより下へ続くことを確認。
- scroll所有調停の実装中にdesktop回帰を再実行し、`bun test Vyline/apps/desktop/src` は **213 pass / 0 fail**、root `bun run typecheck` は **exit 0**。これはKotlin scrollのGREEN証拠ではない。
- **Scroll focused GREEN:** 所有調停を実装しdevelopment build **exit 0 / 36s**、app Wasm `ea9ee2f779bb5de96caf.wasm`。同じ4ケース×3テーマ（dark、390×844）が **12成功 / exit 0**、証跡 `apps/compose-ui/dist/gradle/browser-smoke/dev-1789054526881/mobile/`。Apple長文は `-1037+1526+110=599`、遅延画像は `-651+1140+110=599` で実viewport端に一致し `canScrollForward:false`。長文GREEN PNGを開き65行目・時刻・既読がcomposerより上に見えることを確認。履歴中author=me更新は位置を奪わず、その後の明示scrollLatestは末尾へ移動。storeの受理送信接続、広いgesture/prepend/resize競合、production、lightはこのfocused結果に含めない。
- **Full mobile GREEN:** `node apps/compose-ui/scripts/smoke.mjs --chat --mobile` は **3テーマ成功 / exit 0**、証跡 `apps/compose-ui/dist/gradle/browser-smoke/dev-1789054623933/`。強化した実末尾検査に加えtouch履歴操作、入力focus保持、受信中anchor、アナウンス開閉、viewport縮小、明示send intent、readers/menu回帰が成功。renderer-only fixtureのsend intentであり、store/controller接続や実OS IMEの証明ではない。
- **追加Scroll RED:** 末尾の40 CSS px手前からアナウンス開閉し、再びwheelで実末尾へ戻る検査を追加。`dev-1789054807113/mobile/apple/` は **exit 1**、開閉時anchor差687px。4つの既存focusedケースは引き続き成功。ownershipはhistoryのままで末尾への吸着とは異なる開閉補正の問題として調査中。前述の限定GREENをアナウンス全条件成功とはしない。
- **Accepted-send unit GREEN:** storeの11箇所のdemo／optimistic挿入直後から、account資格付き `chat:scroll-latest` を1回発行。完了／失敗／incoming-me／reconcileには追加しない。既存media圧縮後11,000,000-byte検査を挿入前へ移し、拒否で一時行やscroll intentを作らない。既存manualイベントは互換維持。agentのREDは37成功／26失敗／1error（未実装helper importを含む）、GREEN報告はfull desktop250成功／0失敗とdesktop typecheck／5ファイルlint成功。parent再実行のstore＋appEvents focusedは **68成功／0失敗、322 assertions / exit 0**、diff check成功。host/native送信統合はまだ未実施。
- 最適化scroll buildは **exit 0 / 5m27s**、app Wasm `538abf49bfc05f2fe27b.wasm`。アナウンス追加RED修正前の成果物で、最終production受入ではない。
- **Announcement near-end GREEN:** REDの687pxは画面外AX boundsがゼロになった差分で、実際の最終行offsetは期待411pxに対して580px（169pxずれ）。新paddingの測定前にanchorを破棄していた処理を、要求寸法と実測が一致して補正完了するまで保持するよう修正。headerのtimeline共有scrollableを除去しannouncementのnested scroll/wheelを局所化。development build **exit 0 / 35s**、app Wasm `2286d975df254ba04f4b.wasm`。テストは開閉後の実padding変化を待ち、数値anchorと正のAX boundsを3px未満で検査。5ケース×3テーマdark phone **15成功 / exit 0**、証跡 `apps/compose-ui/dist/gradle/browser-smoke/dev-1789055715925/`。40px手前で吸着せず、手操作で実末尾へ戻ると追従を再取得することを確認。0/2/24件・全位置・本文境界gestureの広いmatrixは未実施。
- **Native send integration GREEN:** 新規 `check-kmp-send-scroll.ts` はaccountless `/pr-demo?stress=90` のnative入力→実pointer送信→既存host controller/store→pane counter→実末尾までを検査。初回 `1789055804162/` はphone Enterが挿入した改行を次ケースに残すテスト不備で失敗（送信は0）。各case間でnative draftを消して独立化した `apps/desktop/test-results/kmp-send-scroll/1789055891435/` は **3テーマ×light/dark、phone6条件成功 / exit 0**。65行の送信が1件だけ追加され、counterは1増加、draft消去、実末尾、iframe/document保持、想定外通信・device/call取得0。既存AudioContext unlockはdevice取得ではないため禁止対象に含めない。Apple light送信PNGを開き65行目・時刻・既読が入力欄より上に表示されることを確認。
- anchor修正後のfull mobile回帰も **3テーマ成功 / exit 0**、証跡 `apps/compose-ui/dist/gradle/browser-smoke/dev-1789055901244/`。Browser paneも最新development bundleのaccountless stress demoを開き最終行90/90の表示を確認。
- **進行中:** 広いアナウンス操作matrixと最終production回帰。**未着手:** アナウンス開閉位置保持、Flex/Rich専用表示、LIFF対応操作、分割hover preview、アナウンス登録確認。以前の弱い末尾判定のPASSは今回の問題解消の根拠にしない。


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
