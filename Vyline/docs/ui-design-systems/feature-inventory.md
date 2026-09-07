# UI design systems 導入前の機能 inventory

最終更新: 2026-09-07

## 概要

UI renderer を切り替える際に維持する機能と、表示コンポーネント内に残る状態・通信を、現在の `tqmane/vyline` のコードから整理した。実装前の基準点は `7bef39a7f56fb5b17ebeb2c34dcbc15a37364dc3`。以下の行番号はこの基準点を指す。新 renderer の完成・動作検証を示す文書ではない。

## 結論

- 認証、チャットデータ、送信、同期の主な共有境界は既存の `authStore`、`lib/store.ts`、`api/client.ts`。別 renderer のために backend / protocol client を再実装する必要はない。
- 表示コンポーネントは純粋な view にはなっていない。特にメディア一括送信、録音、リアクション、プロフィール、ノート・アルバム操作は React 内にも処理がある。これらを残したまま presentation を交換するか、交換箇所に限って controller を抽出する。
- UI 切替に伴う root の remount は、通話と未送信メディアに影響する。画面を切り替える前に生存期間を確定する必要がある。
- `docs/onboarding.md` / `docs/architecture.md` の「通話 UI 未接続」は基準点の実装と一致しない。現在は `CallController` から `useCall`、backend call API、PCM WebSocket まで接続されている。実通話の成立は別途実機検証が必要。

## 前提と境界

| 層 | 現在の正本・根拠 | renderer の責務 |
| --- | --- | --- |
| Workspace | root `package.json` の `Vyline/packages/*`, `Vyline/apps/*`, backend と plugin SDK | 既存 workspace / submodule を維持 |
| アプリ lifecycle | `apps/desktop/src/pages/VylineApp.tsx:23`。認証 bootstrap、利用規約、初期設定、画面選択 | mount 済み runtime に表示を接続 |
| 認証 | `apps/desktop/src/stores/authStore.ts`。アカウント追加・切替・logout | 既存 action を呼ぶ |
| 同期 | `apps/desktop/src/hooks/useVylineSync.ts:75`。イベント、チャット、既読の serial poll と visibility 復帰 | 各 renderer で poll を重複起動しない |
| UI 向け型 | `apps/desktop/src/lib/store-types.ts:65` の `Message`、`:182` の `Chat` | 同じデータ / action を使う。必要な範囲だけ view model 化 |
| API 型変換 | `apps/desktop/src/lib/mappers.ts:1`、`@vyline/types` | LINE metadata の独自再解釈を避ける |
| BFF client | `apps/desktop/src/api/client.ts:177`、`:316`。account path、認証 header、binary upload を共通処理 | 型のある既存 client を再利用 |
| BFF / service / protocol | `backend/src/api/line.ts` → `backend/src/service/lineService.ts` → `packages/protocol`。共有型は `packages/types` | UI 都合で契約を変更しない |
| Theme | `packages/themes/src/index.ts` の `VyTheme` と presets。`components/theme-applier.tsx:5` が CSS variable 化 | UI mode と既存の色・背景・フォント・密度を区別 |

以下の `components/`, `lib/`, `hooks/`, `pages/`, `stores/` はすべて `Vyline/apps/desktop/src/` 基準。

## 観察結果: 維持対象

| 領域 | 現在コードに存在する機能 | 根拠 |
| --- | --- | --- |
| 認証・入口 | Login / subdevice pairing、複数アカウント、規約同意、初回 setup、home/update note、設定への遷移 | `App.tsx:16`, `pages/VylineApp.tsx:23`, `components/sidebar.tsx:1055` |
| Chat shell | narrow 一覧↔会話、sidebar collapse / resize、最大4会話の同時表示、column / 左右分割 / grid、chat drag-and-drop、pane focus / close / resize、account 別 layout 保存 | `components/chat-shell.tsx:82`, `:176`, `:217`, `:313`, `:379`; `lib/chatPanes.ts` |
| Conversation list | 全体 / 友だち / グループ / 公式 / 非表示 filter、検索、recent / unread / custom sort、ドラッグ順序変更、未読数、last-message preview、手動更新 | `components/sidebar.tsx:49`, `:128`, `:205`, `:243` |
| Conversation actions | pin、hide、mute、既読化 / 一括既読、chat 単位の既読無効化、lock、block / unblock、MID / GID copy、分割表示、グループ作成 | `components/sidebar.tsx:375`, `:435`, `:476`; `components/create-group-dialog.tsx` |
| Chat header | back、相手 / group avatar・名前、公式 badge、mute / status、プロフィール、検索、手動 refresh、会話内メニュー、pane drag handle | `components/chat-area.tsx:543`, `:587` |
| History | 日付区切り、同一送信者のgrouping、複数画像group、全文検索のmatch移動とhighlight、過去履歴追加、prepend時anchor維持、最新へスクロール、初期位置・既読制御 | `components/chat-area.tsx:179`, `:207`, `:376`, `:475`; `hooks/useVirtualList.ts:15` |
| Announcements / system | 折り畳み可能なアナウンス、元メッセージへ移動、追加・削除、bounded system / call-event 表示、開催中group call bannerと参加 | `components/chat-area.tsx:184`, `:684`, `:734`; `components/call-event-message.tsx` |
| Text composer | multiline、IME composing guard、desktop Enter送信 / Shift+Enter改行、mobile Enter改行、本文draft保存、cursor insert、textarea自動高さ、ミュート送信と既定値 | `components/message-input.tsx:107`, `:486`, `:522`, `:543` |
| Reply / mention | reply preview / cancel / 元へ移動、group memberの遅延取得、@ALL / @member候補とkeyboard選択、文字編集後range更新、LINE metadata生成 | `components/message-input.tsx:197`, `:229`, `:522`, `:624`, `:700`; `utils/mention.ts` |
| Emoji / sticker | LINE sticon inline draft / overlay / cursor range、sticker・emoji catalog、pack選択、premium表示、favorite、animated / sticky sticker、最大6個のcombination editor、drag / resize / context / long press、受信combination描画 | `components/sticker-emoji-panel.tsx:118`, `:151`, `:311`, `:428`; `components/message-input.tsx:686`; `utils/combinationStickers.ts` |
| Media composer | 画像 / 動画の複数選択、画像paste、image/video drop、pending preview / remove / clear、一括送信、画質設定に従う圧縮、11MB検査、楽観表示、部分成功・エラー表示、upload中表示 | `components/message-input.tsx:141`, `:330`, `:363`, `:595`, `:655`, `:777` |
| Voice message | browser MediaRecorder、許可要求、MIME選択、録音秒数、停止 / 取消 / 送信、track cleanup、音声ボタン表示設定 | `components/message-input.tsx:252`, `:258`, `:298`, `:734`; `lib/store.ts:1978` |
| Send lifecycle | text / sticker / combination / emoji / image / audio送信、楽観message、sending / sent / read / failed、retry intent、account切替後の古い完了結果の抑止 | `lib/store.ts:1454`, `:1573`, `:1669`, `:1864`, `:1978`, `:2220`; `lib/store-types.ts:22`, `:160` |
| Message body | text / link preview / sticon / mention、image・video・audio・file、media group、sticker・combination・emoji、Flex / Rich、location、contact card、note / album notification、system、call | `lib/store-types.ts:23`; `components/message-bubble.tsx:173`, `:312`, `:706`, `:1810`; `components/flex-message.tsx`, `components/rich-message.tsx` |
| Message actions | reply、6種reaction / remove、copy / partial copy、image / video / sticker download、ここまで既読、編集、編集前 / 履歴表示、取消 / 通知せず取消、取消復元、既読者一覧 / 時刻、announcement追加 | `components/message-bubble.tsx:1066`–`:1291` |
| Touch / overlays | message長押しmenu・swipe reply、media lightbox、context submenu、編集dialog、部分copy / history overlay、group作成、Agent I dialog、通知pill | `components/message-bubble.tsx:875`, `:887`, `:934`, `:2165`; `components/message-context-menu.tsx:13`; `components/action-dialog.tsx:4` |
| Plus menu | event作成 / 共有、あみだくじ、poll、ノート一覧 / 作成 / 編集 / comment / like / share / delete / media、album一覧 / 作成 / rename / photos / share / delete | `components/plus-menu.tsx:82`, `:373`, `:678`, `:845`, `:957`, `:1100` |
| Profile / groups | profile detail、local name / server rename、avatar / background、common groups、member profile、DM開始、voice/video call、block / unblock、group leave / dismissed history、member invite、beta block check / Agent I summary | `components/profile-drawer.tsx:35`, `:270`, `:293`, `:544`, `:653`, `:754`; `components/member-profile.tsx` |
| Calls | outgoing / incoming answer、timeout dismissal、group call参加、PCM WebSocket / mic / playback、camera video、member state、video tile layout / resize、mute / end、mobile minimize、docked pane、recordingとlibrary | `components/call-controller.tsx:17`, `:112`, `:166`; `hooks/useCall.ts:49`; `hooks/useCallVideo.ts`; `components/call-panel.tsx:5`; `components/call-video-stage.tsx:13` |
| Settings | profile、既読 / readers、密度 / font / animation / bubble tail / background / voice / mute、NezuTheme preset / custom / import-export、notification、privacy / proxy / block、同期 / Desktop restore、settings import-export-reset、subdevices、storage / backup、recordings、plugins、beta、handoff / diagnostics、情報 / update | `components/settings-sections.tsx:63`, `:124`, `:405`, `:435`, `:717`, `:973`, `:1165`, `:1274`, `:1583`, `:1782`, `:2272`, `:2328`; `components/vy-theme-panel.tsx` |

### 現在の実装を過大に解釈しない点

- `Settings.enterToSend` は型・初期値に存在するが、composer の実際の条件は `isDesktopInteraction()`。現在の設定画面に切替controlはなく、設定値を読んで送信挙動を切り替えてはいない。新UIでこの設定を提供するなら既存機能維持とは別に接続確認が必要。
- composer の file input は `accept="image/*,video/*"`、drop も同じfilter。一般file messageの受信・downloadはあるが、任意file送信controlはここにはない。
- `Message` / `Chat` 型と今回確認したchat/composerに相手のtyping stateは見つからない。見た目のために架空のtypingを表示しない。
- `FloatNotice` は現在hostのchildrenを表示する小さなcomponentで、通知のqueue/timeoutは `lib/store.ts` 側。移植時も通知管理までportable componentに入れない。

## UI切替時の状態寿命

| 状態 | 所在 | 同一storeのままviewをremountした場合 |
| --- | --- | --- |
| account / chats / messages / send状態 / call request | Zustand singleton | メモリ内では維持。page reloadで同じ保証はない |
| text draft / sticon / mention、theme、settings、sidebar幅、custom order | `lib/store.ts:3718` の persist partialize | 保存対象。rendererが重複storeを作らないこと |
| reply target、active chat / panes / highlight / profile / readers | Zustand memory | remountでは維持するがreload永続対象ではない。active chatはrehydrationで明示的にclear |
| pending image/video Fileとobject URL、upload batch flag | `message-input.tsx:141`–`:149` | remountすると失う。送信中の非同期処理だけ残る状態にもなる |
| 音声messageのMediaRecorder / stream / chunks | `message-input.tsx:160` | remountで録音controllerが失われる。切替中もcontrollerを維持する |
| sticker combo編集中の配置・size | `sticker-emoji-panel.tsx:151`–`:156` | remountすると失う |
| call session / WS / audio graph / camera / recording | `useCall`, `useCallVideo`, `useCallRecording` | `useCall.ts:518` のcleanupがWS・mic・AudioContextを閉じる |
| message audio再生・lightbox・menu・編集form・history表示 | `message-bubble.tsx:312`, `:755` | remountすると閉じる / 再生停止 |
| list filter・query / scroll・chat search・announcement展開 | `sidebar.tsx:172`, `chat-area.tsx:133` | remountで失う。scrollは仮想listの再計測も発生 |
| pane配置 | `chat-shell.tsx:192` | account別localStorageから復元するがdrag中状態は失う |
| Settings内編集中form / selected section | `settings-sections.tsx:134` と各section | remountで入力途中状態が失われる |

### CallControllerを上位へ移す際の条件

現状 `chat-shell.tsx:576` が唯一の `CallController` をmountする。`VylineApp` は settings / home への遷移で `ChatShell` をunmountするため、これはUI mode導入前からのlifecycle制約である。

`CallController` を認証後の常設hostに置き、`key` をaccountだけにすればUI mode・settings遷移から通話を切り離せる。`CallPanel` は親elementを `ResizeObserver` で測り、親幅640px以上でflex siblingとしてdock、それ未満でfixed全画面になる (`call-panel.tsx:11`–`:49`)。単にmain直下へ移すだけでは横並びが失われるため、常設flex hostとflex-1の画面領域を合わせて用意する。call overlayの内側は既存 `relative` containerを維持する。

## 最小presentation seam候補

これは調査から得た候補であり、全体architectureの決定ではない。

1. **Chat header**: `chat-area.tsx:587` のnavigation部分を、back / identity / command のpresentationに分ける。chat selection、sync、group call監視、announcements、virtual listは同じcontrollerのまま。Appleは中央avatar/titleとcompact commands、Fluentはleading titleとcommand bar、Miuixはlarge title / trailing actionという差を表現できる。rendererへ渡すeventは既存callbackを使う。
2. **Message framing**: `MessageBubble` の既存content renderer、readers、menu actions、touch handlingを残し、外枠・metadata位置・grouping geometryを差し替える。`ChatArea` は既に `sameAuthorAsPrev/Next` を計算している。group先頭/末尾を明示propで渡せば、Appleのtail最終bubbleのみ、連続bubble corner、timestamp/read配置を設定できる。prop追加時は末尾のmemo comparator (`message-bubble.tsx:2279`) に含める。
3. **Composer surface**: native textarea、IME/caret/sticon overlay、file input、MediaRecorder、pending queue、各send handlerは同じ `MessageInput` instanceで維持し、tools / editor / send / accessory panelの配置を切り替える。見た目の都合でcontrolled textareaのkeyを変えない。Wasm入力へ移す場合は、このcontrollerを先にhook等へ抽出して1つの実体からeventを受ける。
4. **Portable primitives**: `vy-ui.tsx` のToggle/Avatar、`MessageContextMenu` のitems/onClose、`ActionDialog` のtitle/onClose/children、`FloatNotice` のchildrenは既に狭いcontract。NezuUI等へのadapterに向く。menu item作成やbackend呼出しはhostに残す。

## 性能とアクセシビリティの基準

- Message listは `useVirtualList` を使用。可変高さを `ResizeObserver` で計測し、spacerとoverscan（既定10）でDOM数を制限する。UI geometry変更後の再計測、画像読込後補正、prepend anchor、最下端追従を維持する。
- Sidebarも高さ計測とwindowingを行う (`sidebar.tsx:243`)。見えていない会話を大量にglass surface化しない。
- `MessageBubble` は独自 `memo` comparator。mode由来propやmedia grouping propを変更する場合はcomparisonsも点検する。メッセージのたびにstore全体をserializeして別rendererへ渡す方式はこの利点を失う。
- `ActionDialog` はnative `<dialog>.showModal()` のtop layer / focus管理を使用。CSS transform親の中に通常fixed overlayとして戻さない。
- `MessageContextMenu` はmenu/menuitem semantics、Escape / outside pointer / resize / blur closeを持つ。完全なroving arrow navigationは現実装にはない。
- mobile操作判定は画面幅だけでなくUA（iPad desktop UA含む）を使う。layout breakpointとEnter / drag等の操作判定は区別する。
- `index.css:498` の `prefers-reduced-motion`、theme-applierのanimation mode、visual viewport対応、touch targets、ラベルを新しいsurfaceでも尊重する。

## 検証入口と既存check

この調査ではコードの読み取りとinventory作成だけを行った。ビルド成功、実機通信、性能数値をここでは主張しない。

| 対象 | 実在する入口 |
| --- | --- |
| 本番同様のReact UIを仮データで表示 | `/pr-demo` → `pages/PrDemoPage.tsx:10`。`accountId:null`, `demoMode:true`。実アカウントとは別のbrowser contextで使用 |
| 安全な送信・返信・sticker・settings操作例 | `apps/desktop/scripts/record-pr-demo-clips.ts:34`。Playwrightを使う撮影scriptでありassertion suiteではない |
| TS全workspace typecheck | root `bun run typecheck` |
| Frontendのみtypecheck / production build | `bun run --cwd Vyline/apps/desktop typecheck`, `bun run build` |
| Lint | root `bun run lint`（Biome） |
| Store / 同期 / account / readers | `lib/store.test.ts`, `stores/authStore.test.ts`, `lib/chatPreview.test.ts`, `lib/readReceiptRanges.test.ts`, `lib/accountIds.test.ts` |
| History / scroll / pane / interaction | `lib/chatScroll.test.ts`, `lib/chatHistoryWindow.test.ts`, `lib/chatPanes.test.ts`, `lib/interactionEnvironment.test.ts` |
| Message / media / calls | `lib/mappers.test.ts`, `lib/mappers.groupCalls.test.ts`, `lib/mediaGroup.test.ts`, `components/call-event-message.test.tsx`, `utils/combinationStickers.test.ts`, `utils/callAudio.test.ts`, `utils/callRecording.test.ts`, `api/recordings.test.ts` |
| Unit test起動 | root `bun test Vyline/apps/desktop/src`（既存はBun runner） |

実ブラウザ確認では narrow / tablet / laptop / widescreen、IME・multiline・reply・pending media・menu・settings・mode切替・reloadを確認し、DOM bounds / scrollWidth、console / network error、frame timingと長いhistoryのDOM数を記録する。`/pr-demo` のメディア送信は `accountId:null` によりnetwork処理を行わないため、実backend送信検証の代わりにはならない。

## 関連ドキュメント

- [アーキテクチャ](../../../docs/architecture.md)
- [UIモーション](../animation-modes.md)
- [通話実装](../call-implementation.md)
- [PRデモ](../pr-demo-tella.md)
