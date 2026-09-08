# 送信取り消し保護

通常トークで取得済みのメッセージは、送信取り消し後も元の本文・添付情報を保持し、その下に「送信が取り消されました」と表示する。自分のメッセージでは「あなたが送信を取り消しました」と表示する。

## 保存と同期

- 取消直前のメッセージを `revokedSnapshot` に保存し、取消状態と一緒にアカウント別SQLiteへ永続化する。本文、画像・動画・音声・ファイルの情報、返信先などを保持する。
- 取消イベントと履歴取得の `UNSENT` / `UNSEND` を同じ保存処理へ通す。重複通知で履歴を増やさず、通常の履歴再取得で取消状態を戻さない。
- 古いページの取得でも対象IDの保存済みメッセージを返す。差分取得ではカーソル以前の取消状態も返す。
- 自分のメッセージを手動復元した場合、通常の同期では復元状態を維持する。
- 元の内容を取得していない取消通知から本文を生成しない。元の内容が後から取得できた場合は、取消状態を維持したまま保存内容を補う。

実装: [chatStoreSqlite.ts](../backend/src/storage/chatStoreSqlite.ts)、[lineService.ts](../backend/src/service/lineService.ts)、[store.ts](../apps/desktop/src/lib/store.ts)、[message-bubble.tsx](../apps/desktop/src/components/message-bubble.tsx)、[kmp-model.ts](../apps/desktop/src/ui/kmp-model.ts)。

## 画像・動画などの実体

メッセージ情報の保存後、画像・動画・音声・ファイルの原本取得をバックグラウンドへ登録する。受信・履歴取得・保存済み履歴の再表示で登録し、既存のメディア保存先へ書き込む。保存済みの原本は再ダウンロードしない。取消後の取得では `revokedSnapshot` のメディア情報を使用する。

キューは2並列、待機・実行中を合わせて最大1,024件。同じアカウント・チャット・メッセージの登録をまとめ、失敗・満杯の場合は次の同期で再試行する。キュー自体はメモリ上にあるため、再起動後は受信や履歴の再表示で再登録される。保存先の既存サイズ・空き容量制約に従う。

取得が完了する前にLINE側の原本が削除された場合や、鍵・ネットワーク・容量の問題で取得できない場合、メッセージ情報だけから画像や動画を復元することはできない。

実装: [unsendMediaProtection.ts](../backend/src/service/unsendMediaProtection.ts)、[mediaStorage.ts](../backend/src/storage/mediaStorage.ts)。

## プロトコルの根拠

Android 26.13.0の逆コンパイル結果とPrtivateLEINの現行コードを参照した。以下はローカル調査用パスで、解析成果物をこのリポジトリへ同梱していない。

| 根拠 | 確認した内容 |
| --- | --- |
| [rg8/ce.java:72](C:/Users/Tqmane/Documents/Git/line/apk/line-26.13.0-jadx/sources/rg8/ce.java:72) | `DESTROY_MESSAGE=64`、`NOTIFIED_DESTROY_MESSAGE=65`。`7/8` は取消ではない。 |
| [rg8/de.java:474](C:/Users/Tqmane/Documents/Git/line/apk/line-26.13.0-jadx/sources/rg8/de.java:474)、[te8/b1.java:34](C:/Users/Tqmane/Documents/Git/line/apk/line-26.13.0-jadx/sources/te8/b1.java:34) | `param2` がメッセージID。`param3` を整数として読み、正数ならsilent取消。 |
| [te8/r.java:8](C:/Users/Tqmane/Documents/Git/line/apk/line-26.13.0-jadx/sources/te8/r.java:8) | 自身の `DESTROY_MESSAGE` にも同じ取消処理を使用する。 |
| [ob8/b.java:313](C:/Users/Tqmane/Documents/Git/line/apk/line-26.13.0-jadx/sources/ob8/b.java:313)、[ob8/b.java:1142](C:/Users/Tqmane/Documents/Git/line/apk/line-26.13.0-jadx/sources/ob8/b.java:1142) | `UNSENT` / `SILENTLY_UNSENT` のフラグ値は、大文字小文字を問わない `true` または `1`。空本文だけでは取消と判定しない。 |
| [v88/i0.java:972](C:/Users/Tqmane/Documents/Git/line/apk/line-26.13.0-jadx/sources/v88/i0.java:972) | 履歴でもsilent取消と通常取消のmetadataを処理する。 |
| [h74/s.java:615](C:/Users/Tqmane/Documents/Git/line/apk/line-26.13.0-jadx/sources/h74/s.java:615) | 保存済みメッセージをIDで検索し、取消状態へ更新して本文・添付情報を消去する。 |
| [PreventUnsendMessage.java:69](C:/Users/Tqmane/Documents/Git/line/PrtivateLEIN/app/src/main/java/io/github/hiro/LEINs/hooks/PreventUnsendMessage.java:69)、[UnsentRec.java:436](C:/Users/Tqmane/Documents/Git/line/PrtivateLEIN/app/src/main/java/io/github/hiro/LEINs/hooks/UnsentRec.java:436) | LEINは破壊的な処理の前で受信取消を遮断し、`param2` のserver IDから保存済みトークを検索して通知を記録する。VylineもchatMidを保存済みメッセージから解決する。 |

`tools/data/unpacked_LINE.exe` の読み取りでは `NOTIFIED_DESTROY_MESSAGE`、`requestUnsendMessage`、`SILENTLY_UNSENT` の文字列も確認した。文字列の存在だけをフィールド意味の根拠にはしていない。

## 検証

- [chatStore.sqlite.test.ts](../backend/src/storage/chatStore.sqlite.test.ts): 原文・添付情報、再接続、アカウント分離、重複通知、手動復元、未取得原文を隔離SQLiteで確認。
- [lineService.revoke.test.ts](../backend/src/service/lineService.revoke.test.ts): 取消種別・ID位置・metadata判定を確認。
- [lineService.revokeHistory.test.ts](../backend/src/service/lineService.revokeHistory.test.ts): 外部通信を禁止した仮クライアントで、古い履歴ページと差分取得が取消前の内容を維持することを確認。
- [unsendMediaProtection.test.ts](../backend/src/service/unsendMediaProtection.test.ts): 仮クライアントの受信処理で未表示の動画の保存が始まること、取消・再接続後のオフライン配信とRange応答、取得失敗の再試行、暗号化データを復号済み原本として保存しないこと、キュー上限を確認。
- [message-bubble.test.tsx](../apps/desktop/src/components/message-bubble.test.tsx)、[kmp-model.test.ts](../apps/desktop/src/ui/kmp-model.test.ts): 保持した内容と取消通知の表示を確認。

実LINEの送信・取消操作、LINE側原本削除後の取得可否、実機Safari/Androidでの再生は未検証。
