# 正規LINEと互換性のある暗号化動画送信

最終更新: 2026-11-11

## 概要

写真・動画ボタンで選択した動画の送信形式を修正した。元のコンテナ・コーデックは変換せず、認証タグ、ブロックハッシュ、サイズ情報を正規Android LINEの処理へ合わせる。

## 前提

- メインと全4サブモジュールのmainをfetchし、メイン`2c6f5fa`から作業した。
- protocolの固定値`d638290`とfetchしたmain`1523f64`は同じtree。
- 修正は[tqmane/vyline-apiのコミット03a9684](https://github.com/tqmane/vyline-api/commit/03a9684b3fa720b391b7cbb942bcb9bf20b27c0c)。メインのgitlinkで参照する。PRはメイン側の1本のみとし、protocolのmainへ直接pushしない。
- サーバー・端末・実アカウントは変更せず、動画の実送信も行っていない。

## 原因と修正

| 項目 | 従来 | 修正後 |
| --- | --- | --- |
| 動画本体の認証 | 暗号文全体の直接HMAC | 128 KiB単位の暗号文SHA-256を連結し、そのHMACを付加 |
| `__ud-hash` | 未送信 | 同じブロックハッシュ列を生bytesで送信。OBSは`type=file / name=hash / ver=2.0` |
| preview | 無い場合に動画本体を画像プレビューへ代用 | 本物のpreviewがある場合のみ送信し、画像用の通常MACを使用 |
| 動画の`FILE_SIZE` | 暗号文＋32byteタグのサイズ | 元の動画サイズ。出力する`MEDIA_CONTENT_INFO.fileSize`も同じ元サイズ |

受信側は既に動画用MACと旧Vylineの直接MACを両方受け付けていたため、Vyline内での往復だけでは送信形式の違いを検出できなかった。検証ではこの互換デコーダーを正解判定に使わず、独立した厳密な正規形式の計算と比較した。

Blobとファイルからの送信に対応する。追加した`isVideo`引数は既定falseで、画像・音声・一般ファイルの認証方式は変えない。受信時の旧動画互換性も維持する。hashの送信が失敗した場合はチャットメッセージを送らず、一時暗号ファイルを削除する。

## 根拠

指定されたAndroid LINE 26.13.0のJADX結果を参照した。コードや実動画はリポジトリへコピーしない。

- `cq3/c.java`、`cq3/g.java`: 暗号文の128 KiBブロックハッシュとMAC。
- `jy0/n.java:137–176`: previewは任意、hash列は暗号化せず`__ud-hash`へ送信。
- `xe8/h0.java:192`: 動画の`FILE_SIZE`は元ファイル長。

## 検証

- `video_media_e2ee.test.ts`ほか関連33テスト成功。1byte、128 KiB前後、複数ブロック、Blob/ファイル、preview有無、改ざん、旧動画、hash失敗時の中止を確認。
- 合成MP4（H.264/AAC、640×360、2秒、363808bytes）で3ブロック・96byte hash列を厳密検証。復号結果は元と完全一致し、ffprobeでも映像・音声・時間を維持。
- `bun test`: 1154成功 / 0失敗。型チェック、ルートlint、protocolの所定lint、build、stack型宣言生成も成功。

## 制限と取得方法

正規LINE実機での再生は未検証。既に送信した不正形式の動画は自動修復できず、修正版適用後に元ファイルから再送する必要がある。

protocolはメインのgitlinkに固定したコミットを`git submodule update --init --recursive`で取得する。protocol側のmainへ取り込まれるまでは、修正コミットを保持する作業ブランチ`codex/video-auth-compatibility`も維持する。
