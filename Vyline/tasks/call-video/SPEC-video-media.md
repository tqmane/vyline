# video-media

目的: VylineとWindows LINE間で1対1のビデオ通話を発着信し、両方向の映像と音声を利用する。

- ネイティブの互換コーデック・EVS3形式・VIDEO暗号鍵を使用する。
- 初期ビデオ通話は音声を含み、通常の音声通話を壊さない。
- 自分のプレビュー、相手の映像、カメラのオン/オフ、対応端末でのカメラ切替を提供する。
- カメラ拒否・コーデック非対応・映像停止を表示する。カメラ停止で音声を切らない。
- 終了・アカウント切替でカメラ、コーデック、キュー、接続を解放する。
- 認証/所属を確認し、フレーム長・フラグメント数・待機時間・キュー量を制限する。
- 映像をファイルや診断ログへ保存しない。

境界: 既存の認証・Origin・アカウント/セッション確認を使う `/call/ws?sessionId=…&media=video` を動画専用に追加し、PCM経路は維持する。
動画WSのバイナリ: 8バイトヘッダー（version=1, key=0/1, rotation=0..3, reserved=0, BE u32 90kHz timestamp）とAVCC access unit。本文上限1MiB、送信キューは最大2フレーム。接続ごとに状態JSONを返し、カメラ制御は `{type:"video", enabled:boolean}`、結果は状態またはサニタイズ済みエラーで通知する。動画WSの切断だけで音声を終了しない。
Protocolはpmap3/PLANET_RTPのEVS3を送受信する。受信は認証後に順序を復元し、欠落後はキーフレームから再開する。初期ビデオはAUDIO|VIDEO、通話中の変更はSTRM_CTRL START/PAUSE/RESUMEで行い、同じ通話と音声暗号状態を保持する。

一次資料: [WebCodecs](https://www.w3.org/TR/webcodecs/)、[AVC codec registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/)、[SRTP RFC3711](https://datatracker.ietf.org/doc/html/rfc3711)。EVS3固定ヘッダーはWindows ampkit 1.0.0.911の有効な合成入力で6ケースを検証済み。実映像・VFD変種は別途実測する。

対象: Protocol通話、backend通話管理/WS、frontend通話hook/overlay。1段階あたり概ね5ファイル以下に分ける。
検証: ネイティブ由来fixture、不正入力・欠落/順序変更、音声回帰テスト、Windows実通話で双方向の動くテストパターンと復号統計を確認。
コマンド・スタイル・境界は `plan.md` に従う。
