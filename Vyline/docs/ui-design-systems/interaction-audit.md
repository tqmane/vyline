# UI操作全体の監査 — 2026-09-08

対象は既存React UIと、Messages / Fluent / MiuixのCompose UI。スクリーンショットの外観比較に加えて、入力イベント、操作先、状態の更新、閉じ方、操作できない条件を照合した。

「ブラウザ」はアカウントなしの `/pr-demo` に対する実Chromeの操作。「接続確認」はボタンから既存controller/store/APIまでのソース確認であり、実LINEの処理成功を意味しない。既存デモ、追加した仮データ、ブラウザのタッチ入力を使用し、実LINEへの送信・発信・削除・退会は実行していない。

最終追加確認: 開発bundle `b3e98a9d1a17b220e3da` でアナウンスとメッセージ操作が各3テーマを通過。アナウンスは末尾から実際に40 CSS px戻った位置も含め、開閉の移動量は全比較で0pxだった。既読者/「＋」の6表示ケースとメディア3テーマは、その後の `0e09a7715c7992ea32f0` bundleでも通過し、プロフィール・画像ビューアからのフォーカス復帰を確認した。実通信・実機で残る範囲は下記のとおり。

## 調査の入口と証拠

- `apps/desktop/src/components`、`src/pages`、`src/ui` のクリック、変更、キー、タッチ、ドラッグ等を検索。React側554行、Compose側237行の入力処理を検出した。これは検索時点の**実装箇所の行数**であり、テスト数・機能数ではない。
- Composeが許可する71種類のactionはすべてhostの処理分岐へ接続。呼び出し元も処理先もない旧 `message-menu` / `view-media` は許可リストから削除した。
- 一覧・チャット・メッセージ・入力・詳細・設定・通話・ログインを下表に分類。特殊カードや高度な設定は共有React UIを使用するため、その先の操作も追跡した。
- 検出位置とaction照合は `apps/desktop/test-results/interaction-audit/`。実ブラウザ結果とスクリーンショットは各 `test-results/kmp-*-interactions/`、`kmp-advanced-reachability/`。

## 一覧・画面・ペイン

| 操作 | 確認した動作・条件 | 経路 / 検証 |
| --- | --- | --- |
| 一覧行クリック / タップ | 対象トークを開く。下書きはchat単位 | Sidebar → `openChat` / ブラウザ |
| 戻る | 狭い画面は一覧へ。設定・分割選択ではその画面を閉じる | `back` / ブラウザ |
| 検索入力・クリア・Esc | 検索結果を更新、クリアで元に戻す | `search` / 追加ブラウザ |
| 全体・友だち・グループ・公式・非表示 | 既存 `filterChatList` と同じ条件 | 5フィルタ / 追加ブラウザ |
| 最新順・未読順・カスタム順 | 明示的に選択して設定へ保存 | `sort(value)` / 追加ブラウザ |
| すべて既読 | 既読無効chatを除き既存bulk処理へ接続。デモは既存仕様で何もしない | `markAllChatsRead` / 接続確認 |
| 行の右クリック・長押し | 既存のトークメニューを開く | `context` → Sidebar / ブラウザ |
| ピン・非表示・通知・順序変更 | 共有メニューから既存storeへ反映 | `togglePin` / `toggleHide` / `toggleMute` / `moveChat` |
| 一覧行の横スワイプ | 元のReactにもスワイプ操作はない。長押しメニューを使用 | ソース確認。今回新機能として追加していない |
| カスタム順のドラッグ | マウスのみ。既存 `reorderChat` を使用 | 追加ブラウザ |
| サイドバー開閉 | チャット・設定・未選択画面から開閉 | `sidebar-toggle`。チャットは追加ブラウザ、設定/未選択画面は接続確認 |
| サイドバー幅変更 | 260〜520px。ドラッグ、キー、ダブルクリックで360pxへ戻す | `setSidebarWidth` / 追加ブラウザ |
| 分割するトークの選択・キャンセル | 選択したchatを追加、キャンセルで通常一覧に戻る | `split-pick` / `back` |
| 一覧からペインへドロップ | 既存の位置判定と `placeChatPane` を使用。最大4画面 | `drop-chat` / 追加ブラウザ |
| ペイン選択・閉じる・順序変更 | 対象chatのfocusだけ変更。下書き・返信先を混同しない | `pane-focus` / `pane-close` / `pane-move` |
| ペイン配置・境界リサイズ | 横並び、左右分割、4分割、幅/高さ比率 | `check-kmp-panes.ts` / navigation。横並び・右分割・4分割・横境界操作を検証。左分割/上下境界キーは接続確認 |
| 画面幅の変更 | 狭い画面ではフォーカス中のペインを表示、広げると復帰 | ペイン・navigationブラウザ |
| UI読込失敗 | 再試行、Classicへ戻る入口あり | KmpAppHost / 接続確認 |

## メッセージ・ジェスチャー

| 操作 | 確認した動作・条件 | 経路 / 検証 |
| --- | --- | --- |
| 通常本文の単タップ | 本文自体は通常操作なし。リンク・引用等は個別処理 | NativeRichText / MessageBubble |
| 本文内リンク | 既存の安全なURL解析からリンクを開く | ブラウザ。外部サービスの処理成功は対象外 |
| 本文中のメンション | ReactもComposeも名前を強調表示。本文の名前にはタップ操作なし | `MentionSpan` / `NativeRichText`。投稿者プロフィールは名前/アバターから開く |
| 左スワイプ | 横移動18dpで判定、52dp以上で返信。縦スクロールと区別。成功時は利用可能なら `navigator.vibrate(8)` を要求 | MessageGestures / 実タッチ追加ブラウザ。iframe内のspyで8ms要求1回を確認。物理振動は未検証 |
| 右・短距離・縦方向の移動 | 誤返信しない | 実タッチ追加ブラウザ |
| 長押し | メッセージ操作を開く。マウス保持と実タッチの両方 | 追加ブラウザ |
| ダブルタップ / ダブルクリック | メッセージ操作を開く | 実タッチdoubletapをブラウザ確認。mouse doubleclickは接続確認 |
| 右クリック・ContextMenu・Shift+F10 | 同じメッセージ操作を開く | 右クリック/Shift+F10は追加ブラウザ。ContextMenuキーは接続確認 |
| メニューの外側・閉じる・Esc | 対象メニューが消える。下層AXの存在だけで判定しない | 追加ブラウザ |
| メニューのTab移動 | メニュー内で操作を選ぶ | keyboard / focus確認 |
| 投稿者アバター・名前 | グループ投稿者プロフィールを開く | `reader-profile` / 追加ブラウザ |
| 返信・返信解除 | 同じchatの共有返信状態を使用 | `reply` / `cancel-reply` / ブラウザ |
| 引用タップ | 読み込み済み返信先へ移動・ハイライト | `jump-message` / ブラウザ |
| リアクション追加・解除 | 自分の同じリアクションを押すと解除 | shared `reactToMessage` / 追加ブラウザ |
| リアクション不可条件 | 公式、14日超、送信中、失敗、pending、取消を除外 | shared判定 / 単体・追加ブラウザ |
| コピー・部分コピー | nativeコピー、詳細内の既存部分コピーへ接続 | parity / hosted-actionsはメニュー/詳細の入口確認。clipboardへの書込・部分選択完了は未検証 |
| 編集 | 自分の確定済みtextのみ。最新本文を編集欄へ読み込む | `editMessage` / ブラウザ |
| 編集取消・保存 | 取消で元の本文を維持、保存で共有storeへ反映 | 保存はブラウザ。編集取消ボタンは接続確認 |
| 編集済み表示・履歴 | 既存詳細画面へ移動、編集前後・履歴を参照 | `view-rich` / hosted-actions |
| 送信取消・取消済み表示 | 自分の確定済みメッセージのみ。開いた古いメニューを破棄 | `revokeMessage` / ブラウザ |
| 通知なし取消・取消復元 | premium/履歴等の既存条件を使用 | 共有React詳細 / 実通信未検証 |
| 失敗表示・再送 | retry情報がある自分の失敗メッセージだけ再送可能 | `canRetry` / `retryMessage` |
| このメッセージまで既読 | 共有詳細メニューから対象ID付き既読処理へ | `markChatRead` / 実通信未検証 |
| 既読一覧・日時 | 件数・名前・既読時刻を表示、閉じる・Esc・プロフィール。プロフィールを閉じても選択した読者のキー操作を維持 | 3テーマ×2画面サイズ。Tab/Shift+Tab各20回、Enter、ArrowDown、プロフィール復帰直後のEnterで再表示を確認 |
| 古いメッセージを読む | 手動ボタンと、ユーザーが上端へスクロールした場合の自動読込。検索ジャンプでは自動取得しない | history event / fixture確認 |
| 履歴追加時の位置 | 表示中のitemと吹き出しの位置を復元。日付/投稿者見出しの変化も補正 | prepend fixture。共有HTMLカードはitem位置の保持のみ |
| 最新へ移動 | 中腹から最新位置へ戻す | 追加ブラウザ |
| 新着・編集・削除の途中反映 | 開いたメニュー/画像の対象を最新状態で解決。差分更新 | smoke regressions / model tests |

## アナウンス・トーク内検索

| 操作 | 確認した動作・条件 | 検証 |
| --- | --- | --- |
| アナウンス追加 | 既存メッセージ詳細メニューから追加 | parity |
| 閉じた表示 | 先頭1件と件数を表示 | 追加ブラウザ |
| 展開・折りたたみ・繰り返し | 開閉状態をReact controllerと共有 | 3テーマ追加ブラウザ |
| 開閉時のトーク位置 | 2/24件×先頭/中腹/末尾/末尾から実40 CSS px上で同じ吹き出しの画面座標を維持 | 3テーマの全24位置で開閉前後の差0px、最新ボタンの表示状態も維持。0件・空履歴も確認 |
| 複数件のスクロール | 24件fixture。上限288dpかつ画面高38%、入力欄を確保 | 390×844 / DPR2 |
| 本文タップ | 読み込み済み対象メッセージへジャンプ | highlightのstore更新を確認 |
| 解除 | 押したアナウンスだけ消え、件数が減る | デモ共有storeで確認 |
| 設定画面から戻る | 展開状態を維持 | 3テーマ追加ブラウザ |
| 検索開閉・入力 | 一致数・現在位置を表示、空欄でも入力場所が分かる | parity / 追加ブラウザ |
| 前・次・Enter・Shift+Enter | 一致位置を循環 | 3テーマ追加ブラウザ |
| 検索Esc | 検索を閉じ、本文画面へ戻る | 3テーマ追加ブラウザ |
| 0件の検索 | 前/次を無効化 | source / parity |
| キャッシュ外の過去メッセージへのジャンプ | 過去履歴の取得まで保証する実装ではない | 元のReactも同じ制約。実履歴での確認が必要 |

## 入力・添付・メディア

| 操作 | 確認した動作・条件 | 経路 / 検証 |
| --- | --- | --- |
| 入力・カーソル・選択・下書き | 既存MessageInput controllerを使用。テーマ/ペイン切替でも保持 | chat / panes / model |
| Enter・Shift+Enter・送信ボタン | Enter設定とdesktop/mobile判定に従う | chat / actions |
| IME変換 | composing中は確定キーで送信しない | NativeComposer / source確認。実OS IME未検証 |
| メンション候補 | 上下選択、Enter/Tab確定、Escで候補だけ閉じる | actions / smoke regressions |
| 返信中の送信 | 他chatの返信を添付せず、その返信選択を壊さない | 共有sendMessage回帰テスト |
| ミュート送信 | 1通の送信状態を既存controllerへ反映 | 接続確認。ミュート送信の操作・実配信は未検証 |
| 画像・動画の選択 | OS file chooserから既存添付キューへ | chat / media追加ブラウザ |
| ドロップ・貼り付け | 対象ペイン、account/epochを確認して既存キューへ | media追加ブラウザ（File fixture） |
| 添付の個別削除・全解除 | キューとプレビューを更新 | media追加ブラウザ |
| 添付送信・送信中 | 既存圧縮/高画質/アップロード処理、重複送信防止 | controller接続確認。実配信未検証 |
| 任意文書の添付 | 元のReact入力もimage/videoのみ受付 | 今回のCompose差分では追加していない |
| 録音開始・経過・送信・取消 | 共通MediaRecorder処理、音声機能OFF時は非表示 | actionsは合成録音の開始/経過/取消。送信操作・実機マイクは未検証 |
| ブロック・ロック・未準備中 | 入力/送信/添付/録音の利用条件を共有 | controller / smoke regressions |
| 画像タップ | プレビューから `preview=0` の本画像を開く | media追加ブラウザ / URL request確認 |
| 画像長押し・右クリック | メッセージ操作を開く | media追加ブラウザ |
| 静止・アニメーションスタンプ | タップ/Enterで開き、animationを維持 | media追加ブラウザ |
| 画像ビューアの閉じる・Esc | タッチ後も閉じる。アニメーションビューア内のTab/Shift+Tab/Enterで閉じ、元のHTMLスタンプへフォーカスを戻す | 3テーマでEnterによる再表示とEsc後の復帰までmedia追加ブラウザ確認 |
| 音声・動画の再生 | HTML標準controlsを使用 | 合成WAV/WebMの再生/停止をブラウザ確認。シーク/音量の操作は未検証 |
| 音声・動画のメニュー | 右クリック/Shift+F10からメッセージ操作へ | media追加ブラウザ |
| 画像・動画・スタンプ保存 | 共有詳細メニューの既存downloadを使用 | 画像downloadはmediaブラウザ確認。動画/スタンプ保存は接続確認 |
| ギャラリー移動・拡大縮小 | 元のReact lightboxにも専用操作はない | 今回新しいgallery機能は追加していない |
| スタンプ・絵文字パネル | pack/tab/お気に入り/ストア、絵文字挿入、送信 | actionsで絵文字tab/挿入/本文送信を検証。pack/お気に入り/ストア/スタンプ送信は接続確認 |
| 合成スタンプ | 選択・ドラッグ・サイズ変更・削除・全解除・送信 | 共有実装を接続確認。実配信未検証 |
| Flex / Rich / 位置 / 連絡先 / file / 通話カード | 既存Reactをnativeリスト内のHTML slotへ描画 | content / hosted-actions |

## プロフィール・設定・その他の入口

| 操作 | 確認した動作・条件 | 検証範囲 |
| --- | --- | --- |
| 自分のプロフィール | 詳細設定のプロフィール編集へ | source / navigation |
| 相手・グループの詳細 | 開閉、Esc、通知、ピン、メンバー、検索、既存詳細へ | profile / parity / navigation |
| 投稿者プロフィールの閉じ方 | native dialogでフォーカスを取得。Esc・閉じる・背景タップ、Tab移動、閉じた後のiframeへの復帰 | member-profile追加ブラウザ |
| 名前変更・画像/背景変更・保存 | 既存ProfileDrawer/SettingsSectionsの処理 | 入口確認。実LINE更新未検証 |
| グループ作成・招待・退会・ブロック | 元の条件と確認・APIを保持 | 入口/接続確認。送信・退会等は実行せず |
| 設定画面・戻る・Esc | 実画面とstore.screenが戻ったことを検査 | 追加ブラウザ |
| Messages / Fluent / Miuix / Classic / NezuUI | 保存済みmodeと実rendererを切り替える | navigation / chatでnative3種相互・Classic切替。NezuUIは接続確認 |
| システム・ライト・ダーク | appearance更新と再表示 | navigation / parity |
| Enter送信・音声・密度・しっぽ・既読一覧 | 各nativeスイッチから既存設定へ | 5項目navigation |
| 詳細設定14カテゴリ | プロフィール、既読、表示、外観・UI、通知、プライバシー、詳細・復元、サブデバイス、ストレージ、通話記録、プラグイン、ベータ、引継ぎ・診断、情報 | 3テーマで全カテゴリを開いて内容/戻るを確認 |
| 表示設定 | 文字サイズ、animation、常時mute、ステータス、背景、並び順等 | 既存SettingsSections。各設定の保存/全画面反映を全組合せで確認したものではない |
| ノート・アルバム・イベント等 | PlusMenuの5入口と未ログイン時のdisabled/理由 | 3テーマで入口確認。内部API未検証 |
| メニューの階層・戻る・閉じる | 既存host menuをnative化し、viewport内に配置 | hosted-actions / NativeHostMenu |
| アカウント切替・追加・ログアウト | 詳細設定AccountSwitcherの既存処理を使用 | 接続確認。実セッションは操作せず |
| リロード・再接続・同期 | 既存bootstrap / useVylineSyncを維持 | 接続確認。稼働backendでの確認は未実施 |

## 通話・アカウント・保存処理で残る検証

以下はUIの存在や既存実装への接続を確認したが、今回の環境では実処理を検証していない。

| 機能 | 操作先 |
| --- | --- |
| 音声/ビデオ発信、グループ通話参加 | `requestCall` → CallController / call hooks |
| 着信の応答・通知を閉じる | CallController / incoming call state |
| 通話終了・マイクmute・カメラ・カメラ切替・画面共有 | CallOverlay / useCallVideo |
| 通話を小さくする・復帰・通話ペイン幅変更 | CallPanel |
| 映像の位置・分割・参加者ページ切替 | CallVideoStage |
| 手動/自動録音、音声/動画形式、開始/停止、記録一覧 | CallRecordingControls / CallRecordingLibrary |
| メール・QR・保存セッションでログイン、セッション削除 | LoginPage / authStore |
| 同意画面、初回設定の前/次、設定保存・復帰 | TosConsentGate / VylineSetup |
| サブデバイスのペアリング、解除、ブロック | SubdevicePage / SubdevicesSection |
| バックアップ作成・復元・削除、Android/iOS取込 | account backup / AdvancedSection / backup panels |
| キャッシュ/保存済みメディア削除、録音ファイル管理 | StorageSection / recording library |
| 引継ぎZIP、診断ログ出力/削除、Issue画面、proxy適用、ブロック解除 | HandoffSection / PrivacySection |

実LINEの送受信・通話、OSの日本語IME、実機Safari/Android、バックアップ復元などは、上のデモ検証で代替できない。全機能の実運用成功を宣言するには、接続先と実機を使った確認が別途必要。

## 追加の表示崩れ・通話画面調査

利用者から追加指定された既読者一覧、アナウンス、「＋」、通話画面について、閉じた状態と表示後を比較した。

- 既読者一覧: FluentのCardの透過で背後の本文が読者名に重なる問題を確認。Fluentの面を不透明にし、Appleの読者行にも濃い面を付けた。閉じるボタンは44dp以上へ調整し、タッチだけで常時出ていた手動フォーカス枠をキーボード操作時だけ表示する。
- 既読者のプロフィール往復: Fluent行の重複したボタンの入れ子を除去し、各行を1個の操作対象にした。親のプロフィールdialogを閉じるとiframeのBODYへ戻る問題は、実window focusイベントでCanvasと選択中のCompose操作へフォーカスを復旧することで修正。Escで戻った直後も選択した読者をEnterで再び開けることを検証した。読者一覧のTab/Shift+Tab各20回、ArrowDown/Enter、閉じる・Escも確認した。
- 既読者ボタンへの初回入力: 末尾から1〜12px離れた状態でも「最新のメッセージへ」が表示され、既読件数の上でタップを取っていた。既存の末尾付近の判定をボタンの表示にも使い、重なりを除いた。
- アナウンス: 2件の展開で同じ吹き出しが全3テーマで49px下へ移動し、24件では画面外へ押し出される例を確認。ヘッダー高さの増減でLazyColumnの上余白が変わる際、表示中のメッセージ位置を補正する。入力欄の高さ変更と処理を統合し、ヘッダーの補正が入力欄の伸縮に伴う末尾移動を打ち消さないようにした。末尾判定は入力欄の占有領域を除く。追加でMiuixの末尾から40 CSS px上では折りたたみ時に9pxずれ、最新ボタンも出現する不具合を再現した。先頭1項目だけの保持をやめ、表示中のキーと座標を保持して再配置後も残る項目で補正することで、585.5→594.5pxだった位置が585.5→585.5pxになり、最新ボタンも出現しなくなった。
- スワイプの振動: 共有Reactと同じ8ms要求を成功した返信だけに追加。実iframeの `navigator.vibrate` spyで右方向0回、成功時1回、短距離・縦・リンク始点の移動で追加0回を全3テーマで確認。Compose自身の長押しは別途 `[0,30]` を要求しており、返信の8ms要求と分けて記録した。振動対応端末での物理的な出力は未検証。
- 「＋」: メニューの幅と並びに加えて、画像読込後の実表示とキー操作を検査。Appleのノート・アルバム・予定等の5アイコンを指定のSF Symbols原本へ置き換えた。他テーマも既存SVGアイコンの様式へ揃え、項目の高さは44px以上を確保した。
- 通話: 667×375の横画面で映像が終了ボタンへ重なっていた。映像/参加者のスクロール領域を操作部から分離し、高さ480px未満では狭いドッキングを避ける。短い横画面は映像と操作を左右に配置する。
- 通話操作: 56pxの操作面とラベルを揃え、Apple/Fluent/Miuixの面・角丸を適用。カメラOFF・カメラ切替・終了をそれぞれの意味のアイコンにした。小さくした通話の終了にも受話器アイコンを使用する。
- 録音/録画: 操作を開閉可能にし、実行中・保存中・エラー時は開いた状態を維持。開始準備と保存を区別し、失敗理由を見出しにも表示する。
- 「＋」の内部フォーム: アルバム/ノートの画像選択をTab/Enterで開けるよう修正。あみだくじの参加者と結果、候補日時、投票の各選択肢/削除に名前を付けた。未ログイン時はClassic/NezuUIも利用できない理由を表示する。通話の状態変更とエラーは支援技術へ通知し、カメラを使えない理由は常時読める位置に表示する。

既読者/「＋」は375×667・390×844/DPR2の各3テーマ、計6表示ケースを通過。閉じるボタンの実測高はApple 44.5px、Fluent 44px、Miuix 45pxで、メニューは画面内に収まり横方向のはみ出しもなかった。`apps/desktop/test-results/kmp-readers-plus-layout/results.json` と各画面の画像を保存した。
メディアは390×844/DPR2の3テーマで、本画像の要求、画像download、アニメーションのキー操作とフォーカス復帰、合成音声/動画の再生・停止とメニュー、ファイル選択・個別削除・全解除・合成drop/pasteを通過。結果は `apps/desktop/test-results/kmp-media-interactions/results.json`。実機マイク、実配信、シーク/音量、実LINEのメディア取得成功を保証する結果ではない。
アナウンスと返信振動の追加証拠は `apps/desktop/test-results/kmp-announcement-interactions/results.json`、`kmp-message-interactions/results.json` と、それぞれの `timeline-finish-final.log`。

通話の検証は `scripts/call-layout-fixture.tsx` が実際のCallPanel/CallOverlay/CallVideoStage/CallRecordingControlsを描画し、操作先だけをローカルstateに置き換える。`useCall` / `useCallVideo` / `useCallRecording` の実処理は実行しない。
`scripts/check-call-layout.ts` では3テーマ、375×667・667×375・1440×900/DPR2を使用。画面幅だけでなく、操作ボタン中心へのhit testで映像に覆われていないことを確認する。
音声・ビデオ・12人グループ・失敗・開始中・デバイス取得中・接続中・呼出中・終了中・終了済み・録音準備中・保存中・録音開始失敗の13状態、計117表示ケースを通過した。
各テーマ/画面サイズでmute往復、カメラON/OFFと切替、終了、記録の手動/自動・音声/動画・開始/停止、最小化/復帰を確認。広い画面のペイン境界と映像分割境界はクリック直後の方向キー操作も確認した。
PiPの移動/サイズ変更、映像タイルの固定/順序、参加者ページ、実着信の応答/通知、実録音/WebRTC/通信はこのfixtureの検証に含めていない。117は表示ケース数であり、通話や録音の成功回数ではない。

SF Symbolsのコピー元は `C:/Users/Tqmane/Documents/Git/yyyywaiwai_apps/iMonos_android/SFSymbols/`。
通話7ファイルと「＋」5ファイルは原本を編集せず使用し、`src/assets/call-symbols/sources.json` と `src/assets/plus-symbols/` のmanifestに対応元とSHA-256を記録した。
参照元ディレクトリは変更していない。

## Apple Liquid Glassのインタラクティブ動作

`C:/Users/Tqmane/Documents/Git/themes/AndroidLiquidGlass/app/src/commonMain/kotlin/com/kyant/backdrop/catalog/` の `components/LiquidButton.kt`、`components/LiquidBottomTabs.kt`、`utils/InteractiveHighlight.kt`、`utils/DampedDragAnimation.kt` を直接参照した。`AppleMotion.kt` / `AppleLiquidTabs.kt` はこの実装から、`Animatable` と `spring` によるpress progress、ポインタ移動、`layerBlock` の移動・伸縮、lens・highlight・shadow・innerShadowの動的変化をCompose/Wasmへ組み込んでいる。押下位置の光もBackdropのSkia RuntimeShaderを使用する。ボタン、名前、検索・入力欄、送信・録音、フィルタに接続し、Webを理由とする静的な代替描画にはしていない。動きを減らす設定では位置を即時更新し、形状のアニメーションを止めるが、押下のフィードバックと操作は残す。

タブは一覧と異なる画面領域にあり、一覧だけを記録したBackdropにはタブ文字が含まれなかった。上流と同じく、操作・読み上げ対象から除外したローカルのタブ行を記録し、`rememberCombinedBackdrop` を通じて選択レンズへ渡した。これにより実際のタブ文字が拡大・屈折する。記録する行は選択レンズ自身を含めず、描画の自己参照を避けている。

実ブラウザではマウス操作後のタッチで押下もクリックも発生しない不具合も再現した。Compose 1.12がホバー中のマウスポインタを次のタッチイベントへ残し、Foundationの `awaitFirstDown` が `fastAll` で全ポインタのdownを要求するため、押されていないマウスがタッチを妨げていた。`Bridge.kt` は同じCanvas上のボタンを押していないマウスに限り、タッチ開始前にhoverの終了を通知する。実際に押されているマウス、HTML入力・メディア、タッチイベント自体は置き換えない。

開発版でlight/dark × 通常/動きを減らす設定の4ケースを通過した。実CanvasのPNGを比較し、マウス押下・中間フレーム・ドラッグ・取消後の復帰、Spaceによる押下と起動、タッチ押下と取消、タブのドラッグ・最寄りへの確定・キー選択を確認。通常設定では中間フレームが変化し、動きを減らす設定では即時の表示が安定した。タブ文字の屈折も画像で確認した。証拠は `apps/desktop/test-results/apple-liquid-motion/results.json` と各PNG。

記録用タブ行に実際のサイドバー背景色を含め、屈折した文字の下に元の文字が透ける問題も解消した。設定変更でCompositionLocalProviderの階層が変わり、開いたフィルタが消える問題は、同じ階層で値だけを切り替えて修正した。

この最終調整後、開発版 `4ba5a0d3e65548d5a6a8.wasm` と配布版 `91b30b2396f88f29a7fd.wasm` の両方で4ケースすべて成功。表示中の動作設定切替後にもフィルタを保持してドラッグ選択できること、マウスホバー後のタッチ押下・取消・起動まで確認した。配布版のPNG/結果は `apps/desktop/test-results/apple-liquid-motion-production/`。実機Safari/Androidの描画・物理入力は今回のChrome検証には含まれない。

## Compose Webの支援技術に関する制約

固定依存の `ui-wasm-js 1.12.0` の `ComposeWebSemanticsListener` も確認した。
現在のWeb実装はクリック可能要素のroleをbuttonへ置き換え、selected/stateDescription/disabledのDOM同期が未実装。
アプリ側のCompose semantics指定だけでは、スクリーンリーダーへ選択状態や無効状態を完全に伝達できない。
また、アクセシビリティ用DOMの位置更新には100〜1000msの遅延があり、初回生成時のclick callbackを保持する。
このため、今回のブラウザ検証はDOM上の `.click()` に頼らず、更新後の実座標へマウス/タッチを入力し、共有storeの結果を確認している。
キーボード操作の修正・検証とは別に、スクリーンリーダーの完全対応は未完了として残す。

## 再実行

`apps/desktop` で開発サーバー起動後、以下を実行する。すべてアカウントなしのデモを確認してからfixtureを使用する。

```powershell
bun scripts/check-kmp-announcement-interactions.ts
bun scripts/check-kmp-message-interactions.ts
bun scripts/check-kmp-media-interactions.ts
bun scripts/check-kmp-member-profile-interactions.ts
bun scripts/check-kmp-navigation-interactions.ts
bun scripts/check-kmp-advanced-reachability.ts
bun scripts/check-kmp-readers-plus-layout.ts
bun scripts/check-call-layout.ts
bun scripts/check-plus-accessibility.ts
bun scripts/check-apple-liquid-motion.ts
```

配布previewでは `VYLINE_TEST_URL` をpreview URLへ設定し、`bun scripts/check-apple-liquid-motion.ts --production` を実行する。新しいブラウザコンテキストのデモ画面だけを操作し、API・外部へのリクエストは遮断する。

既存の `check-kmp-chat.ts` / `check-kmp-actions.ts` / `check-kmp-parity.ts` / `check-kmp-panes.ts` / `check-kmp-content.ts` / `check-kmp-hosted-actions.ts` も併用する。ビルドやHMRと同時に走らせるとデモ状態が再初期化されるため、配布物更新が終わってから実行する。
