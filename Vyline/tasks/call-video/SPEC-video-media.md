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
動画WSのバイナリ: 8バイトヘッダー（version=1, key=0/1, rotation=0..3, reserved=0, BE u32 90kHz timestamp）とraw VP8フレーム。本文上限262140バイト、送信キューは最大2フレーム。接続ごとに状態JSONを返し、カメラ制御は `{type:"video", enabled:boolean}`、結果は状態またはサニタイズ済みエラーで通知する。動画WSの切断だけで音声を終了しない。
Protocolはpmap2 normal-video / PLANET_RTPのEVS3_VP8を送受信する。先頭断片にはraw長+3を18bitで示す3バイトを付加する。WindowsがAVC-only pmap3を採用しないこと、pmap2は内部codec11（VP8）であることを確認したため、AVC変換コードは採用しない。受信は認証後に順序を復元し、欠落後はキーフレームから再開する。初期ビデオはAUDIO|VIDEO、通話中の変更はSTRM_CTRL START/PAUSE/RESUMEで行い、同じ通話と音声暗号状態を保持する。

一次資料: [WebCodecs](https://www.w3.org/TR/webcodecs/)、[VP8 codec registration](https://www.w3.org/TR/webcodecs-vp8-codec-registration/)、[VP8 RFC6386](https://datatracker.ietf.org/doc/html/rfc6386#section-9.1)、[SRTP RFC3711](https://datatracker.ietf.org/doc/html/rfc3711)。Windows ampkit 1.0.0.911の有効な合成入力でEVS3 PD 6ケースとVP8長ヘッダー4ケースをネイティブ関数と照合済み。VFD/SVCは広告せず、通常VP8を使用する。

2026-09-06 実測: 音声接続後のSTART/PAUSEが成功。合成VP8 450フレームを送信し、Windows内libvpxで449フレームの復号成功・640×360画像出力・エラー0を確認。Windowsの画面上にも合成パターンを確認。逆方向の受信・本番UIの全経路は継続検証中。実カメラ映像は保存しない。

対象: Protocol通話、backend通話管理/WS、frontend通話hook/overlay。1段階あたり概ね5ファイル以下に分ける。
検証: ネイティブ由来fixture、不正入力・欠落/順序変更、音声回帰テスト、Windows実通話で双方向の動くテストパターンと復号統計を確認。
コマンド・スタイル・境界は `plan.md` に従う。
