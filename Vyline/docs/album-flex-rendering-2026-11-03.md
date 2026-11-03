# アルバム表示・画像中心Flexの修復

更新日: 2026-11-03

## 対象

`tqmane/vyline` main `aa28fe7`（PR #77マージ後）から `codex/album-flex-rendering` で修正。通話・既読処理とprotocol submoduleは変更しない。サーバーは利用者が開いた画面の読み取り調査のみで、ファイル変更やインストールは行わない。ADB/Fridaや端末再起動は使用していない。

## 原因

- 実画面の公式アカウントでは、Flexの画像やボタンのDOMは存在したが、13個の `.T1` がすべて幅0・高さ0だった。`.Ly*` の幅が百分率だけで、画像中心のカードをcarouselの自動幅の子に置くとintrinsic幅がなくなり縮んでいた。Rich画像は直接幅を持っており、同じ画面でも表示されていた。
- アルバム通知はchatIdなしでアルバム一覧だけを取得しており、写真取得・表示に接続されていなかった。＋メニュー側も写真のOBS参照をflatなoidとして読んでいた。写真を削除等に使うphotoIdと、取得に使う`obsResourceId.oid/sid`を分離する必要がある。

## 修正

- `.Ly*` に既存サイズの実寸幅を与え、`max-width:100%` で狭い画面に収める。画像中心の単一bubbleとcarouselを描画し、横スクロールを維持。空のcarouselにはalt textを表示する。
- 通知クリックと＋メニューの両方を共通のアルバム一覧・写真一覧・拡大表示に接続する。account/chat/albumを各リクエストに指定し、切替・閉じる操作で古い読み取りを中断する。ページング・再試行・画像再取得を用意する。
- OBS `sid` を保持してサーバー側で画像・元画像・動画を取得する。ChannelTokenはクライアントへ返さない。401はAlbum channelだけを1度再発行し、失敗したレスポンスのbodyを解放する。
- mediaのRangeを検証・転送し、206/416とbyte rangeヘッダーを保持する。429/503等はstatusとRetry-Afterを保持し、LINE側の非公開本文は返さず、エラーをキャッシュしない。
- 独立した境界不具合としてnumeric contentType 22/17の分類例外を修正し、Flex rootとRich objectを検証する。carouselの子はtypeが省略されてもbubbleとして描画する。実画面13件の原因をparserの不備とは断定しない。Richの既存geometry既定値・数値変換は維持する。

## Android 26.13.0との照合

利用者指定のJADX結果の下記実装を参照した。コードや実アカウントのpayloadをコピーせず、テストは合成データを使う。

| 参照ファイル（`sources/` 以下） | 確認事項 |
| --- | --- |
| `ob8/b.java` | Album通知の`cafeId/chatId` metadataキー |
| `tj0/h.java` | Album photo responseの`nextCursor/hasMore` |
| `b30/p.java` | OBSの`/r/{svc}/{sid}/{oid}/{tid}`とAlbum用ヘッダー |
| `rg8/q7.java` | RICH=17 / FLEX=22 |
| `o62/j.java` | Flex rootはbubble/carousel、carouselの子はbubble parserへ渡す |
| `tc8/c.java` | Richのcanvas/scenesはFlexとは別の構造 |

## 検証と限界

- `tests/flex-layout.browser.mjs`: 320/375/768/1440pxで画像中心の単一bubble・carouselが200px超の実幅/高さを持ち、横スクロールと空データのfallbackを確認。修正前は実幅0の失敗を再現した。
- `tests/flex-native-layout.browser.mjs`: 5モード×375/1440pxの10ケース。実mapper・Compose host slotを含むアプリで描画を確認。外部通信は遮断する。
- `tests/album-rendering.browser.mjs`: 通知/＋メニュー、写真表示・拡大、画像/動画の再試行、ページング、account/chat切替、native controllerと既存ノートの16チェック。書き込みAPIは呼び出さない。
- `bun test`: 1067件成功、失敗0。parser/mapper、Album presentation、media service/Rangeを含む。`bun run typecheck`、`bun run lint`、`bun run build`も成功。
- 通話・既読に関する既存53関数/分岐と保護対象ファイルの変更がないことをASTとgit差分で確認した。

修正版の実LINE Album取得、実動画のseek、端末上の動作は未検証。利用者のサーバーへの適用・再起動は実施していない。
