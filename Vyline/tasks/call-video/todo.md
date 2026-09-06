# 進捗

- [x] 着信イベントを遅い履歴同期から分離し、回帰テスト・配布（PR39）
- [x] 着信バナーが再読み込みなしで出ることを実画面で確認（Windows LINEから発信、2026-09-06）
- [x] chat-refresh: 2箇所のボタン・失敗通知・状態保持テスト
- [x] chat-refresh: 全体検証・PR40・配布（e010c7e、データ保存先維持）
- [x] chat-refresh: 公開ページで1280px/320px実表示・2箇所の再取得操作を確認
- [x] video-media: ネイティブの初期フラグ・pmap・MCMMDの静的調査
- [x] video-media: 制御されたWindows観測でEVS3_VP8のフレーム/分割形式を確定（Fridaの合成ヘッダー照合、Windows送受信で確認）
- [x] video-media: 型契約・パケット化/復元と不正入力テスト（別モデルの追加レビュー指摘も回帰テスト化）
- [x] Checkpoint: 映像transportのfixture検証、既存音声テスト維持（Protocol 170テスト成功後、native codec flagの回帰テストも追加・成功）
- [x] video-media: 認証済み動画フレーム経路・ライフサイクル（アカウント分離・動画だけの切断テスト）
- [x] video-media: ブラウザ符号化/復号、映像表示、カメラ操作（合成VP8で実デコーダーとoverlay描画、1280px/320pxを確認。本番ブラウザの実カメラは後段）
- [x] video-upgrade: 同一通話上の開始/停止制御と切替UI（Windows実音声通話のSTART/PAUSE、ブラウザの後処理テスト成功）
- [x] Checkpoint: 初期ビデオ通話でWindowsへ150フレーム送信し、Windowsから163フレーム受信・再構成
- [ ] Checkpoint: Windows LINEとの双方向映像・音声、途中切替、終了を実測
- [ ] 最終レビュー・型/Lint/build/tests・PR・配布・保存データの保持確認

## 追加要求（2026-09-06）

- [x] 1対1映像のmain統合・配布（PR41 / 0a35adc、保存先と他サービス不変）。公開ブラウザ↔Windowsの映像を確認、ユーザーも動作確認済み
- [x] 小窓ドラッグ・タップ入替・キーボード操作・枠と名前・分割/一覧レイアウト（媒体DOM維持、実ポインター操作、4タイル合成テスト）
- [x] 5種類のモーダルの画面外表示を共通箇所で修正し、各画面をブラウザで検証（320/768/1024/1440px、低い横画面、長いタイトル、横幅、Escape/フォーカス復帰）
- [ ] グループ音声: 現行コードとnativeの契約確認、接続/退出/音声の実装と実測
  - [x] group route/参加拒否/bridge、XRTP、40ms EAS2、SSRC別PCM混合の実装と合成テスト
  - [x] 接続中のアカウント予約、終了競合、HTTP status/endの所有アカウント検査
  - [x] 会議通知の有界FULL/PARTIAL parser、展開上限・不正入力テスト
  - [x] PDTP再構成/動的ACK/credit、初期contents、2人の会議通知を実媒体経路へ接続
  - [x] Windowsの指定グループ・ミュートを確認。Vyline→Windowsの合成音をnative PCMまで実測
  - [x] HTTP/WS参加者通知、音声参加者カード、離脱音声の破棄、アカウント切替競合を回帰検証
  - [ ] Windows→Vyline・複数人の実音声/退出をテスト
- [ ] グループ映像: 会議参加者/SSRC、複数映像、レイアウトと固定対象の選択
- [ ] 通話・ビデオ通話の実装docsをMarkdownで記録
  - [x] `Vyline/docs/call-implementation.md`に配布済みと作業中の実装・制約を記録。グループ完了後に実測結果を追記する
- [ ] 新規変更のレビュー・テスト・PR・配布・正常性確認

既存の別作業の計画は変更しない。未検証を完了扱いにしない。

UI段階の検証（2026-09-06）: Bun 554成功/0失敗、全workspace型検査、Lint、production build成功。
ブラウザ回帰は `bun Vyline/apps/desktop/tests/serve-call-ui.ts` から再実行できる。
別モデルでの追加レビューはユーザー指定で省略。同モデルレビューの長い見出し・フォーカス復帰の指摘は修正・回帰検証済み。

グループ基盤段階（未配布）: Bun全体574成功/0失敗、型検査・root Lint・UI production build成功。
その後に追加した共通RTP channel fieldテストも成功。Protocolの新規/変更parser・sessionのscoped Lint成功。
Protocol全体のscoped Lintには既存のnoDelete等の指摘があるため、「全Protocol Lint成功」とは扱わない。

グループ音声/UI段階（未配布）: Bun 590成功/0失敗、全workspace型検査、root Lint 287 files、追加PDTP/conference/session parserのscoped Lint、UI build成功。ブラウザ`/group`で参加者増減・旧発信の終了・古いWSの無効化・カード/ミュートを検証。320/768/1024/1440pxと640x360で横はみ出しなし。
