# 進捗

- [x] 着信イベントを遅い履歴同期から分離し、回帰テスト・配布（PR39）
- [x] 着信バナーが再読み込みなしで出ることを実画面で確認（Windows LINEから発信、2026-09-06）
- [x] chat-refresh: 2箇所のボタン・失敗通知・状態保持テスト
- [x] chat-refresh: 全体検証・PR40・配布（e010c7e、データ保存先維持）
- [x] chat-refresh: 公開ページで1280px/320px実表示・2箇所の再取得操作を確認
- [x] video-media: ネイティブの初期フラグ・pmap・MCMMDの静的調査
- [ ] video-media: 制御されたWindows観測でEVS3のフレーム/分割形式を確定
- [x] video-media: 型契約・パケット化/復元と不正入力テスト（別モデルの追加レビュー指摘も回帰テスト化）
- [x] Checkpoint: 映像transportのfixture検証、既存音声テスト維持（Protocol 167テスト成功。Windows実映像は未検証）
- [x] video-media: 認証済み動画フレーム経路・ライフサイクル（アカウント分離・動画だけの切断テスト）
- [x] video-media: ブラウザ符号化/復号、映像表示、カメラ操作（合成映像150フレーム生成。実カメラは未検証）
- [x] video-upgrade: 同一通話上の開始/停止制御と切替UI（統合テストとブラウザの後処理テスト成功。Windows実通話は未検証）
- [ ] Checkpoint: Windows LINEとの双方向映像・音声、途中切替、終了を実測
- [ ] 最終レビュー・型/Lint/build/tests・PR・配布・保存データの保持確認

既存の別作業の計画は変更しない。未検証を完了扱いにしない。
