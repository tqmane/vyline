# 通話・ビデオ通話の実装

更新: 2026-09-07。実装の正本は本文で示すソース。個人・グループの音声／映像はPR44配布後にユーザーが動作確認済み。今回追加するレイアウトと録音・録画は合成媒体で検証しており、実際の他者の会話は録画していない。配布記録は[PR44](https://github.com/tqmane/vyline/pull/44)と後続PRで追跡する。

## 検証・配布状況

| 範囲 | 状態 |
|---|---|
| 1対1音声・着信応答 | Windows LINEとの実通信確認済み |
| 1対1 VP8映像・音声からの切替 | PR41で配布。Windows LINEと公開ブラウザの双方向映像を確認 |
| 小窓の移動・入替・枠・分割・一覧 | PR42で配布。媒体DOMを維持する回帰テスト、実ブラウザ操作を確認 |
| 5種類の作成ダイアログ | PR42で配布。公開ページと320px幅・低い画面で確認。作成/送信自体はテストしていない |
| グループ音声の経路・XRTP・SSRC別ミキサー | PR43で配布。Vyline→Windowsの合成音をnative PCMまで確認。Android→Vylineは通常の仮想マイク入力とミュート・再開を実測。複数人同時発話は合成テストのみ |
| 会議通知のFULL/PARTIAL解析 | PR43で配布。PDTP受信・ACK/credit・初期一覧へ接続。指定グループの実参加者2人、UIへの状態通知を確認 |
| グループ映像 | PR44で送信修正も配布。Android 26.14.0との双方向伝送を実測し、配布後にユーザーが音声と双方の映像を確認 |
| ギャラリーページ・分割比・独立通話ペイン | 今回追加。9人の合成タイル、媒体DOM維持、320〜1440px、トーク操作と折畳みをブラウザーで確認 |
| 録音・録画・設定の通話記録 | 今回追加。生成音声／映像を実MediaRecorderで圧縮し、実BFFへ保存、Range・再生・DL・削除を確認 |
| 保存先・WebDAV | 別ローカルパスへの実保存をGUIで確認。WebDAVは所有する隔離サーバーで転送・検証・再送・Range・切断・30秒無応答・削除を確認。実NASは未確認 |

直前の配布版はPR44の`1107e1f`、Protocolは`d518e05`。CI・Security Scan・ARM64コンテナ生成、サーバーのhealthyと既存data/storage・Compose設定・他コンテナの維持を確認した。今回の機能の配布完了は後続PRの確認記録を参照する。

### 2026-09-07の送信修正（PR44で配布済み）

- グループのVIDEO指定を参加offer・通話種別・service IDへ反映する。
- 生成済みのVFDをRTP拡張へ渡す。下りパケットで拡張が省略されても、上りの省略はできない。拡張なしではLINE受信入口にVIDEOが現れず、追加後はSRTP認証まで進むことを比較確認した。
- VFDのB/Eは圧縮レイヤー配列の先頭/末尾を表す。単一レイヤーでは全RTP断片で両方を立てる。EVS3 PDのbegin/end・RTP markerとは別の意味であり、受信検証でも一致を要求しない。Android 26.14.0の`vns_evs_rtp_xtn_ctx_build_vfd`（0x866b14、境界判定0x866cb4）とv1 encoder（0x88bbf0）で確認した。末尾BE16はレイヤーごとのパケット連番。
- 2つのVFD修正後、同一グループのAndroid側で観測区間中656個のVIDEOパケットが認証に成功し、429回のデコード成功と画面の継続更新を確認。65秒の参加ではVylineが885フレームを実送信し、Androidの仮想カメラから647フレームを受信した。実画像・音声・鍵値は保存していない。
- Androidの録音入力へ6秒間の660Hz合成音を一時的に渡し、LINE→実サーバー→Vylineで324フレーム・311,040サンプルを復号。660Hz成分が約96%を占めることを確認した。音声・映像同時の65秒参加でも338音声フレーム、614映像フレームを受信し、885映像フレームを送信した。
- 上記の合成音検証時は通常マイクと公式gRPC注入が無音だった。その後、Windowsの既定入力をVoicemeeter Out B1と確認し、Pixel_9を`-no-snapshot-load -allow-host-audio -camera-front webcam0`で再起動。通常入力でLINEのOpus入力が非ゼロとなり、XSplit Broadcasterに対応するwebcam0の映像も表示された。ホスト入力許可・再起動を同時に変更したため、無音の原因をどちらか一方に断定していない。AVDのデータやWindows既定デバイスは変更していない。
- 合成音注入なしの65秒ビデオ通話で、Android→Vylineの3,242 PCMフレーム・3,112,320サンプル（peak 11,809）と649映像フレームを受信し、Vylineから885映像フレームを実送信。XSplit映像を実ブラウザの通話overlayに描画した。別の音声専用通話では2,142 PCMフレームを受信し、マイクOFFで受信が無音・停止、ONで再開することを5秒単位の集計で確認。実音声・映像は保存していない。
- グループのビデオ通話入口を有効化。配布後にユーザーが個人・グループの音声とビデオ、グループビデオでの双方の映像を確認した。以下の古い方向別比較は修正前の観測であり、現在の未対応一覧ではない。

回帰検証: RTP拡張欠落・分割時のVFD境界・VIDEO参加指定をRED→GREENで確認。Bun全体606成功、Deno通話215成功、workspace型検査・root Lint・production build成功。実ブラウザで映像ライフサイクル、ドラッグ・入替・分割、3つの独立decoder/canvas、退出後の古いフレーム破棄、4タイル・フォーカス表示が成功。既存の大きいbundleに関するbuild警告は残る。

## 層と責務

1. `apps/desktop/src/components/call-controller.tsx`: アプリ内で1つの発着信UIを管理。
2. `apps/desktop/src/hooks/useCall.ts`: 音声WebSocket、マイク、PCM再生、終了時の後処理。
3. `apps/desktop/src/hooks/useCallVideo.ts`: カメラ・VP8 WebCodecs・動画WebSocket・描画。
4. `backend/src/api/line.ts`: アカウントを含むHTTP入出力。業務処理は`lineService.ts`へ委譲。
5. `backend/src/call/callManager.ts`: アカウントごとの通話、WebSocket、媒体ループの寿命を管理。
6. `backend/src/call/sessionFactory.ts`: ルート取得、端末identity、transport/codec選択。
7. `packages/protocol/stack/client/features/call/session.ts`: 参加・応答・終了の状態機械とPCM/codec接続。
8. 同ディレクトリの`planet/transport.ts`: PLANET/Cassini信号と暗号化RTP。Andromedaは別transport。

## 1対1の接続と暗号

発信は`acquireRoute → connect → SETUP/INVITE → CONN → in-call`。着信はTalk通知の既存ルートとcommunication IDを使い、`VERIFY → CONN`で応答する。着信のために別の発信ルートを取得しない。

PLANET制御信号と媒体SRTPは別の暗号処理。媒体の候補鍵は交渉した材料から導出し、受信SRTPの認証成功を確認して選択する。平文媒体へのフォールバックはない。nativeのanswerは暗号方式を1つだけ選択する必要がある。

`CallSession.start()`は同じ開始Promiseを共有する。失敗後の再呼び出しで古いルートを成功として返さず、接続処理中に終了された通話を`in-call`へ戻さない。

## 音声

ブラウザとBFFの音声は48kHz/mono/16-bit PCM。Opus符号化はサーバー側で行う。PLANETのnormal-audio（pmap 1）のpayloadはraw OpusではなくEAS2なので、`planet/eas2.ts`で変換する。

1対1は20msフレーム。グループ経路は20ms Opusを2個まとめ、宣言した40ms ptimeのEAS2を作る。CELTのspeech mask、異なるTOC設定、可変長フレームを維持する。古い録画済みDATA/RTCPパケット列の再送は除去した。

グループのVSD extensionは2フレームそれぞれのsignalと、実PCMから計算した音量を含む。OpusScriptにはLINE独自のactivity getterがないため、DC除去後の入力が-60dBov以上ならactive、静かな末尾を200ms保持する互換判定を使う。デジタル無音は即座にSILENCEへ戻す。nativeの確率分類と同等ではなく、雑音もactiveになり得る。固定の録画済みVSDを再送しない。

グループ受信は`SRTP認証/復号 → XRTP → 内側RTP → SSRC別EAS2/Opus → PCM mix`。内側RTPは平文で、二重にSRTP復号しない。`receiveAudio()`はSSRC・timestamp・Opusフレーム群を保持し、単純なフレーム列へ潰さない。

`groupAudio.ts`は最大30ソース、初期60msの余裕、20msごとの混合出力を使う。キューは各ソース最大10チャンク、1チャンク最大120ms、無通信30秒でcodecを解放する。遅着/順序逆転は破棄し、PLCや高度な適応jitter bufferは未実装。これを実ネットワークの音質保証と混同しない。

## 1対1映像

- ブラウザはVP8を符号化し、受信は`VideoDecoder`からcanvasへ描画する。
- PLANET normal-video（pmap 2）はEVS3。`planet/evs3.ts`がpicture ID、fragment、長さ、key/delta、回転を扱う。
- 1フレーム上限は262140 bytes。VP8のheader、key-frame marker、partition、解像度/面積を検証する。
- 欠損後・カメラ再開後はkey frameまで待つ。PAUSE後に遅れて届いた映像は表示しない。
- 音声中のカメラ開始/停止はMCのMCMMD制御で行い、音声接続やルートを作り直さない。
- カメラはユーザー操作で開始する。終了・アカウント変更・permission待ちの競合でも、不要になったtrack/encoder/decoderを解放する。
- MCMMD応答は必須header・SSRC・codeの境界を検査する。未使用のoptional senderが宣言bodyを超える場合、native（0x5d5970）同様にsenderだけを無視する。外側paddingをsenderの一部とみなさない。グループの成功応答（sender長6、残り4）で開始が失敗していた問題を実通信から修正した。

## HTTP / WebSocket

HTTP入口は`/api/line/:accountId/call/start|answer|end|status|active`。グループの通話中バッジ用照会は`group-status`。ルートだけを返す`POST .../call`は診断用で、通常UIの開始経路ではない。

WebSocketは`/api/line/:accountId/call/ws?sessionId=...`。動画は`&media=video`を追加する。Origin・認証・アカウントと通話の対応を検証し、動画だけを閉じても音声は維持する。最後の音声接続を失った孤立通話は終了する。

動画v1 binary契約（`packages/types/src/callVideo.ts`）:

| offset | 内容 |
|---|---|
| 0 | version=1 |
| 1 | key frame=0/1 |
| 2 | rotation=0..3、90度単位 |
| 3 | reserved=0 |
| 4..7 | timestamp、big-endian uint32 |
| 8以降 | raw VP8 |

グループ下りはversion=2とし、offset 8..40に会議で検証済みのMID（ASCII 33 bytes）、41以降にraw VP8を置く。v1の1対1・ブラウザ上り契約は維持する。上りのsourceMidはBFFで拒否し、ブラウザによる送信者の偽装を許可しない。

ブラウザは現WSの参加者一覧にある映像sourceだけを受理し、MID別に最大30 decoder/canvasを持つ。退出・カメラ停止時にそのdecoderだけを閉じ、遅いcallbackは世代検査で破棄する。再参加時にはkey frameを待つ。

HTTPのstatus/endにもアカウント一致検査があり、不一致は404とする。開始前のルート取得中もアカウントを予約して、同時発信/着信応答が競合しないようにした。再試行によって別のグループを勝手に作らない。

## 表示

`call-video-stage.tsx`は同じ媒体DOMを維持し、CSSの位置・順序・gridだけを変える。薄い枠と名前で映像範囲を示し、フォーカス/分割/一覧、表示対象の固定、小窓のドラッグとタップ入替に対応する。ドラッグ後のclickとキーボード操作は区別する。

4タイルの一覧/固定表示は合成harnessで検証済み。1対1の自分/相手に加え、PR43でグループの実hookと参加者別canvasを接続した。3人の独立decoder、離脱した人の遅着破棄をブラウザで確認した。320/768/1024/1440pxと640x360で終了ボタンを画面内に残す。映像待ちでも大きな通話アイコンをヘッダーに重複表示しない。参加者が遅れて届いても、ユーザーが固定を選んでいなければ空の自分タイルを主表示に固定しない。

グループ音声は参加者カードを使い、一覧だけをスクロールする。取得前・長い名前・12人・自分のミュートを検証した。相手のstream存在を「マイクON」とは表示しない。

参加者通知は既存HTTP/WS状態のoptional `participants`として配信し、媒体SSRCはブラウザへ渡さない。CallSessionは離脱した音声sourceのcodec/bufferを破棄し、その後の遅着を再生しない。アカウント切替ではCallControllerを再作成し、遅れて完了した旧発信は終了する。旧WebSocketの通知で新しい通話を上書きしない。

作成ダイアログは`action-dialog.tsx`のnative `<dialog>.showModal()`を共有する。transformを持つ親要素からtop layerへ出し、タイトル/閉じる操作を固定、本文だけをスクロールする。Escapeや閉じる操作で元のボタンへfocusを戻す。

## グループのnative根拠と修正前の比較記録

Windows ampkit 1.0.0.911（SHA256 `AE3BECEC677C16E5EAA2AC2D830E63678DBE3862B71BEB9C615B5D1BF218DF79`）の静的解析:

- XRTP demux `0x209ba0`。PLD extension ID 3の長さはQUIC-style big-endianで、protobuf varintではない。
- PDTPの会議notifierはservice=`PLANET` / stream ID 1。完成messageから`conf_msg_container`を解析し、comp_type 1ならmsg部分だけをzlib展開する。
- `PARTICIPATE_RSP.contentsType=1`はraw `conference_info`。compContentsType 1ならcontents全体を展開し、初期一覧を適用してからPDTPの差分を重ねる。初回PARTIALも受理し、version 0はnativeに合わせて未バージョン化として扱う。
- `pdtp.ts`は最大16 stream、1 message 256KiB、1 stream 256 fragment、全buffer 1MiB。offsetを連続化し、重複を二重配送せず、矛盾するoverlapを拒否する。ACKは実際に受信したPNだけを対象にし、ACK-onlyにはACKを返さない。creditは残量ではなく絶対上限。
- counted sectionのnative宣言長は`N + v62Width(N)`だが、実長は`N + v62Width(count)`（Nはelementの合計長）。既知recordを構造解析して両形式の長さを検査する。固定で1バイト引く処理はしない。
- groupのbridge案内と実媒体portが異なる実通信を確認。認証成功したDATA/音声の送信元を共有の媒体宛先学習へ通す。認証前の受信元へ送信先を変更しない。
- `conference.ts`はFULL/PARTIAL、version、connect、src_listを解析する。connect欠落は不正record。src_listはPARTIALでも置換し、0件なら以前のSSRCを消す。通知全体のatomic rejectは本実装の安全側の方針で、nativeのmember単位skipとは異なる。
- 展開後256KiB、512参加者、各32ソースを上限とする。member/SSRC対応はRAM内だけで保持し、ログへ出さない。
- CC PUSH（oneof55/0x2150）の会議更新とREL（oneof7/0x2145）を処理し、同じtransactionへ成功応答する。交渉済みCIDまたは自分が要求したCID以外は適用しない。REL_RSPを送信してからsocketを閉じる。
- channel_info（0xd85050）のversion/tag1、chan_id/tag2、member/tag11を解析する。member_state 0は解除、1/2はsource置換。会議で接続中のMID/V SSRCと交差させる。無名の通常conferenceでは、nativeの0x5f1f2d/0x5a8cf0と同様にrosterのsourceへ既定channel 0で要求する。明示channel_infoが届いた後はその対応を優先する。PDTP共通headerのchannelを映像channelとみなさない。
- standalone MC STRM_REQ（oneof55/0x318d）でV sourceを購読する。native同様uidは省略、srcid/tag3、NEW_STREAM/tag5、SVC encoding=1/tag6、channel/tag7、VP8/VGA layer/tag8を使う。最大30 source、5秒ACK期限、処理中の最新更新は直列に反映。別のMC OPENを新設しない。
- publisherへのSTRM_REQも受信する。現在callのCID/MC channel、local VIDEO SSRC、指定UIDを照合し、同じtransactionへSTRM_RSP（0x328d、result=0/rel_code=0）を返す。これは受付ACKで、codec成功の宣言ではない。VP8/VP8A framingを要求に合わせて選び、要求が来る前・STOP後は送らず、開始/codec変更後はkey frameを待つ。要求だけでユーザーのカメラをONにしない。
- MC NOTIFY_STRM（oneof59/0x318f）はCID・MC channel・source・既知の映像channelを照合する。PAUSE/STOPで該当assemblerとブラウザdecoderだけを破棄し、RESUMEはkey frameを待つ。成功応答はresult/rel_codeの両方を明示的に0にする。
- pmap 7/4のgroup videoは`PD + PD extensions + 6-byte profile + codec別length + raw VP8`。profile codec3（VP8）は3-byte 18bit長N+3、codec4（VP8A）は4-byte BE長Nで、profile長はN+4。nativeの0x182266..0x182581と同様、VP8Aの長さ情報を変換し、圧縮body自体は変更しない。両形式は同じlibvpx decoderへ接続される（0x9bd7b0）。
- PDのSID/TIDとprofile flagsを照合する。実WindowsはRTP profile 0x0200・VFDなしでSID2、TID1/2/3を送信した。受信はsourceごとに最初のkey frameのspatial streamを選び、その全temporal frameを保持する。別SIDを無条件に混合したり、RTP連番の穴を補ったことにしたりしない。複数SIDの交互切替・VED version2は対応済みとしない。
- 送信はnative実測に合わせたprofile 0x0200、単一SID2/TID1とtype8 base descriptor。SID番号とresolution classは別の値であり、解像度をSIDから推測しない。修正前はserver転送が不成立だったが、上りVFDとレイヤー境界の修正でAndroidの認証・decode・表示に到達した（上記PR44記録）。

実測（指定グループ、Windowsマイク/カメラOFF）: Vylineから短い440Hz合成音を送信。WindowsでSRTP音声224 packetを認証し、XRTP内側225 packetを処理。native decoderで499 PCM frame / 479040 samples / 48kHzを確認し、peak 0.0341、クリッピングなし。合成音の数値集計のみで、PCMや鍵は保存していない。逆方向はまだ実測していない。

グループ映像の追加実測: pmap7・VFD v1・PT121が交渉され、Windowsから約146 frame/10秒を受信・再構成。25秒の受信では358 frameを既存useCallVideo/CallOverlayへ流し、実WebCodecs decoderと640×360 canvas表示を確認した（保存なし、ブラウザ警告/例外なし）。一方、合成映像を90/300 frame送ってもWindows側のVIDEO SRTP受信は0。双方向成功とは扱わない。

PR43配布後の比較: 正しい参加判定を反映してもWindowsへの映像は未到達。nativeの復号前入口でもPT121を確認できなかった。native独自のCCFS_FB2受信報告では、通常の送信先へのVIDEOパケット受信が報告されたが、これはSRTP認証成功の証明ではない。最初のbridgeへ映像の送信先を固定すると、この受信報告も0になった。遅延測定要求への応答をローカル試験で追加しても映像転送は改善せず、これらの比較用処理は製品コードへ入れていない。

PR44配布前の比較: グループ参加信号が音声固定だったため、VIDEO指定時のcommTypeFlags=3、groupcall.video、V初期状態=1を接続した。音声/ビデオの分岐をRED→GREENで検証したが、この時点では初期ビデオ参加でもWindowsへの映像は未到達。初期発信ボタンは当時は無効で、その後のVFD修正・実通信確認を経て有効化した。

以上はPR44以前の時点別記録。現在はユーザーが個人・グループの音声と映像を確認済み。3人以上の同時実通話、複数SIDの交互切替、VED version2、全OS／ブラウザーの組合せは未検証。`getGroupCall`失敗を「通話なし」に変換する処理は禁止。

## 通話通知と参加専用の開始

`lib/mappers.ts`は`contentMetadata.TYPE=G / RESULT=INFO`を一般の不在着信にしない。`GC_EVT_TYPE=S/E`が開始／終了、`GC_MEDIA_TYPE=AUDIO/VIDEO`が通話種別。開始カードと`GroupCallBanner`は同じ`useGroupCallStatus`の状態を参照する。既存直列pollを25秒間隔・非表示時停止で使い、アカウント／トーク変更後の古い応答を適用しない。BFFの照会キャッシュは20秒。

`POST .../call/start`は`{ to, callType: "AUDIO" | "VIDEO", joinOnly?: boolean }`。参加ボタンは`joinOnly: true`を付ける。`sessionFactory.ts`がルート取得前に最新の`getGroupCall`を確認し、終了済みなら拒否する。トーク履歴の古い「開始」から新しい通話を勝手に作らない。照会失敗は終了扱いにせずエラーのまま返す。

## レイアウト・ペインの寿命

正本は`components/call-video-stage.tsx`、`call-panel.tsx`、`call-controller.tsx`、`chat-shell.tsx`。

- ギャラリーは領域に応じたページ構成。狭い320pxで9人なら4／4／1タイル。フォーカス、固定対象、前後ページ、スワイプ、タップ入替を提供し、離脱時は有効なページへ補正する。ページ外のcanvas・streamも同じDOMとして保持する。
- 分割／フォーカスの境界はドラッグ、矢印、Home/End、Enter、ダブルクリックで変更する。比率は20〜80%、既定は分割50%・フォーカス75%。ポインター移動をタップ入替やページ送りとして二重処理しない。
- サイドバーを除いたトーク領域が640px以上なら、トークと通話は兄弟ペイン。通話は初期400px、双方に最低320pxを残して境界を動かす。ブラウザー幅だけで判定しない。
- 狭い場合は全画面通話と「トークを見る」で折り畳む復帰バー。折畳み後も媒体・録画は継続し、復帰／終了／記録状態を残す。新規ウィンドウや別WebSocketは作らない。
- デスクトップの非モーダル通話はトークからfocusを奪わない。狭い画面で展開中だけfocusを通話内へ閉じ込め、折畳み後はトークを操作できる。320×480でも終了ボタンを可視に保つ。
- 音声参加者は縦にスクロール可能な一覧。自分のミュートを表示し、相手のstreamがあるだけではマイクONと推測しない。

## 録音・録画の設計と媒体経路

仕様は`tasks/call-video/SPEC-call-recording.md`、`SPEC-recording-library.md`、`SPEC-recording-storage.md`。共有型は`packages/types/src/callRecording.ts`。

サーバーのRAMとCPUを増やさないため、圧縮・映像合成はブラウザー、永続化とWebDAV転送はBFFとする。サーバーにffmpeg、ブラウザー録画用の別接続、文字起こし、無人録画サービスは追加しない。

```text
既存マイク（ミュート反映）＋受信PCM → Web Audioの記録用mono出力
自分のvideo＋参加者別canvas → 1280×720 / 15fpsの合成canvas
  → MediaRecorder → 512KiB以下に分割 → 所有者固定BFF → fsync＋SQLite ACK
  → 完了したローカルファイル → 必要ならWebDAV検証転送
  → 設定「通話記録」から認証付きRange再生／DL／削除
```

`useCall.getRecordingAudioTap()`は既存mic/playbackノードをgain 0.5で混合し、マイクのOFFは自分の音だけを無音にする。元の通話用trackを停止しない。`utils/callRecording.ts`は映像をcontain配置し、名前と映像OFFの代替表示を描く。UI、トーク本文、OS画面は含めない。ギャラリーで非表示の参加者も記録対象。

MediaRecorderの実対応を開始前に検査する。音声はOpus WebM、映像はVP8＋Opus WebMを優先し、WebM／MP4の対応候補へ降りる。未対応なら開始しない。すべてのブラウザーでMP4が使えるとは保証しない。実ブラウザー検証はOpus/VP8 WebM。

### 開始・停止・アカウント切替

- 初期は手動・録音・自動OFF。相手の同意が必要で、LINE側に録画表示は送信されない旨を開始前に説明する。相手へのメッセージを自動送信しない。
- 通話画面の手動／自動と録音／録画はその通話の選択。将来の既定値は設定画面で保存する。進行中の種別変更は停止してから行い、既存ファイルへ異なる媒体を継ぎ足さない。
- 自動は`in-call`で開始する。グループでは有効な自分のMIDと他参加者を確認して待機を解除し、自分以外が0人なら記録だけを停止する。再参加で新しい記録を作れる。手動停止は自動をOFFにし、直ちに再開しない。
- 容量上限の4MiB手前で停止し、末尾用余裕を残す。自動なら保存完了後に次のセグメントを開始できる。アカウントの残量不足は自動で既存記録を削除して解決しない。
- 通話終了時はMediaRecorderの停止を要求してから通話媒体を解放する。末尾イベント後に記録用trackも解放し、ネットワーク完了を通話の終了条件にしない。
- `captureBackendFetch()`が開始時のBearerとinstallation IDを固定。Cloudflare Access等のプロキシ認証を維持するため、固定したinstallationヘッダーがある場合は`credentials: same-origin`でCookieも送る。BFFは明示ヘッダーがあればアプリCookieへフォールバックしないので、旧記録の末尾が新アカウントの認証へ切り替わることはない。installation IDを固定できなかった場合はCookieを除外する。旧hookの完了通知も現在のアカウントを照合する。
- `pagehide`、ページ破棄、スリープ、ロック、バックグラウンド制限下の録画継続は保証しない。`start(1000)`は正確な1秒分割ではなく、ブラウザー内部で大きく蓄積することがある。8MiB制限はイベントとして受け取ったBlobの保持量であり、ブラウザー内部RAMの厳密な上限ではない。

### 保存の状態と境界値

`state`は`recording / ready / interrupted`、外部保存は別の`transfer=null / pending / complete / error`。`ready`でもWebDAV転送待ちはあり得る。失敗時に保存済みと表示しない。中断ファイルは保存済みの接頭部分であり、形式によっては再生できない。

| 境界 | 実装値 |
|---|---|
| HTTP実ボディ | チャンク512KiB、JSON 16KiB、受信期限15秒 |
| サーバー同時処理 | ボディ付き4件、削除を含む変更16件、超過429 |
| ブラウザー | 保持Blob合計8MiB、1要求20秒、最大3試行、待機500/1000ms |
| 終了時の保存 | 全体90秒で打切り、BFFは最後の通話確認から2分の末尾猶予 |
| 再試行 | 通信失敗、408、429、5xxのみ。401/403/409/507等は即停止 |
| 記録サイズ | 最大2GiB、アカウント残量以下を開始時予約、開始には8MiB以上必要 |
| ディスク | 512MiBの安全余裕、メディア書込と共有する予約カウンター |
| 一覧・保存先 | 1ページ50記録、保存先は1アカウント16件 |
| 保持 | 作成時から初期30日、0は無期限、APIは0〜3650日 |
| 保守 | 起動時に未完了を中断へ回復、以後60秒ごと・無更新2分、期限削除は1回50件 |
| WebDAV | DNS 5秒、無通信30秒、HTTP要求ごとに最長20分、転送workerは全体1件 |

索引は`${VYLINE_STORAGE_DIR}/call-recordings/index.sqlite`。`recordings`は所有者・時刻の索引と、所有者ごとに1つの記録中行を保証するunique indexを持つ。設定と保存先も同DB内。媒体は選択先の`sha256(owner)/UUID.webm|mp4`。タイトルやMIDを保存パスの部品にしない。

ACKはファイルのfsyncとSQLite `synchronous=FULL`コミット後。Linuxでは作成したディレクトリーの親も同期する。再送は既ACK範囲を読み、同じバイトだけを受理する。穴、部分重複、別内容、終了後追記は409。クラッシュ後に実ファイルがACKより長ければ切り戻し、短ければ中断＋欠損表示とし、ゼロ埋めしない。完了・転送・削除・期限処理は記録単位で直列化し、削除はファイル処理後に索引を消す。

容量は既存10GiBのアカウント集計へ実記録＋未使用予約を追加。開始はバックアップ／復元と同じアカウントロックで枠を確保し、通常・Android・iOS復元の履歴予算でも控除する。録画中のチャンクを長時間のバックアップロックで待たせない。従来の通常受信履歴／メディアまで含む厳密な全体quota保証や、別システムの全ディスク予約統一を新設したわけではない。

保持設定変更は将来の記録のみ。無期限でもアップロードが止まれば中断へ回復する。期限を過ぎたWebDAV削除が失敗した場合は行とコピーを残して次回保守で再試行するため、期限ぴったりの完全消去は保証しない。

## 通話記録API

共通prefixは`/api/line/:accountId/recordings`。正本は`backend/src/api/recordings.ts`と`service/callRecordingService.ts`。既存RemoteAccessGuardの内側で、DBでもownerとIDを同時照合する。下表の成功応答には`ok: true`を付け、失敗は`{ ok: false, error }`。絶対媒体パス・秘密は公開行に含めない。

| Method / 相対パス | 入力 → 成功応答 |
|---|---|
| GET 空パス | `?cursor=<前ページ末尾ID>` → `{items, nextCursor}` |
| GET `/settings` | → `{preferences, targets, roots, credentialProtection}` |
| GET `/paths` | `?prefix=<入力中の絶対パス>` → `{items, truncated}`。許可ルート内のフォルダー候補、最大20件 |
| PUT `/settings` | `{automatic, kind, retentionDays, targetId, consentAccepted}`全項目 → `{preferences}` |
| POST `/targets` | `{name, kind: local|webdav, path, username?, password?, allowPrivateNetwork?, allowInsecureHttp?}` → 201 `{target}` |
| POST `/targets/:targetId/test` | ローカルの存在・許可範囲、またはWebDAV `PROPFIND Depth:0`を検査 → `{ok:true}`。書込能力の完全な証明ではない |
| DELETE `/targets/:targetId` | 参照する記録があれば409、未使用なら削除 |
| POST `/start` | `{sessionId, title, kind: audio|video, mimeType, consentAccepted:true}` → 201 `{recording}`。通話所有者と`in-call`を予約前後に照合 |
| PUT `/:id/chunks` | `X-Recording-Offset`、binary body → `{recording}`の`bytes`がACK位置 |
| POST `/:id/finish` | `{durationMs, interrupted?:boolean}` → `{recording}`。再送で二重完了しない |
| POST `/:id/retry` | → 202 `{recording}`。WebDAV workerを開始しHTTPは待たせない。別の転送中は429 |
| GET `/:id` | → `{recording}` |
| GET / HEAD `/:id/file` | 単一Range対応。`?download=1`はattachment、他はinline。無効範囲416 |
| DELETE `/:id` | 所有するローカル／外部コピーを削除。再送は冪等 |

再生／DLはブラウザー標準controlsとリンクを使う。GET/HEADのみ既存installation-bound HttpOnly Cookieを使えるため、URLへトークンを載せたりファイル全体をBlob化したりしない。変更APIはBearer＋installationヘッダーが必要で、Cookieだけの削除は401。ファイル応答は`private, no-store`、`nosniff`、サイズ・Content-Type・生成ファイル名を設定する。

ローカルはACK済みの範囲だけをBun.fileから配信。WebDAVはBFFからストリーム取得し、206、Content-Range、Content-Length、実受信バイト数を検証する。外部URLやWebDAV資格情報をブラウザーへ渡す再生方式ではない。

## 保存先の運用とWebDAVの確定処理

設定「通話記録」で、サーバー既定領域、許可された別パス、マウント済み外部ディスク、WebDAVを選択する。GUIで登録するローカルフォルダーは既存の絶対パス。既定許可ルートは`VYLINE_STORAGE_DIR`、追加は`VYLINE_RECORDING_ALLOWED_ROOTS`（Windowsは`;`、Linuxは`:`区切り）。Dockerではコンテナーから見えるパスを使い、事前のmountが必要。GUIはOS mount、Compose、権限を変更しない。

保存先は新規IDの不変定義として記録ごとに固定し、選択変更で古い記録を移動しない。参照中の保存先は削除不可。実パスと許可ルートを照合し、シンボリックリンクは拒否する。共通の保存先でもアカウントIDのSHA-256をサブフォルダー名として自動作成するため、アカウント名の変更や同名アカウントで記録が混ざらない。WebDAVも固定namespace＋owner hash＋生成UUIDへ限定する。

パス入力は250msの小休止後に候補を取得し、旧入力への応答を破棄する。UIは同じテーマの候補一覧と短い2択の種類選択を使い、候補を押しただけでは登録／既定値変更をしない。サーバーは許可ルートを先に正規化して包含を確認し、各経路要素をlstatしてリンクを辿る前に拒否する。最大64階層、走査512エントリー、返却20候補、同時4件。隠しフォルダーと64桁16進の管理用アカウントディレクトリーは候補・直接入力の探索から除外する。これは完全なファイルブラウザーではなく、上限到達時は候補が一部であることを表示する。許可ルートと祖先は管理者が管理する安定したファイルシステムを前提とし、敵対的OSユーザーの瞬間的な差替えに対するopenat相当の保証はない。

WebDAVはHTTPS＋Basic認証。資格情報入りURL、query、fragment、redirectを拒否する。DNSの全候補を検査して選んだIPへsocketを固定し、TLSは元hostで証明書を検証する。LANのRFC1918 IPv4／ULA IPv6は明示許可、平文HTTPはさらに明示許可かつLANに限定。loopback、link-local、metadata、IPv4変換・特殊範囲は許可しない。IPv6は保守的な許可範囲で、`2001::/16`も現在は対象外。証明書検証を無効にする設定はない。

必要なWebDAV機能は`PROPFIND / MKCOL / PUT / GET (Range) / MOVE / DELETE`。親のURLフォルダーは事前に存在させる。記録完了後の確定手順は次のとおり。

1. `vyline-recordings/<owner hash>/`をMKCOL。既存finalがあればサイズとSHA-256を読み戻し、一致した場合だけ既存結果を利用する。
2. 同じ記録専用の`UUID.ext.partial`だけを除去して再作成。PUTは`If-None-Match:*`、ファイル読込は64KiB単位。
3. stagingをGETで最後まで読み、ローカルとサイズ・SHA-256を照合する。
4. 同一保存先のfinalへ`MOVE Destination:... / Overwrite:F`。既存ファイルを上書きしない。412でもfinalを再検証し、一致しなければ失敗。
5. finalを再度GET検証してからDBを`complete`にし、ローカルを削除する。途中失敗は`error`とローカルを残し、設定画面から再試行／DL可能。pendingは保守workerも処理する。

一度の確定でファイルを複数回読み戻すためネットワーク量は増えるが、PUT成功コードだけで唯一のコピーを消さない。MOVEやRange未対応のサービスを対応済みと扱わない。削除は当該UUIDのpartial/finalだけで、保存先の既存ファイルを列挙・一括削除しない。[WebDAV MOVE / Overwrite仕様](https://www.rfc-editor.org/rfc/rfc4918.html#section-9.9)に従う。

Windowsの資格情報は既存DPAPI(CurrentUser)を利用。Linuxは0700の記録ディレクトリー内の0600 SQLiteであり、OS暗号化済みとは表示しない。サーバー管理者／同じOSユーザーからの秘匿は提供しない。録画媒体もアプリ独自の保存時暗号化はなく、必要なら保存先の暗号化を運用側で設定する。音声、映像、資格情報、鍵、パケット本文は診断ログへ記録しない。

## 再現可能な検証

リポジトリルートで実行:

```powershell
bun test
bun run typecheck
bun run lint
bun run build
bun run --cwd Vyline/packages/protocol stack:types
tools/data/re-tools/deno-2.9.6/deno.exe test -A --no-check --unstable-sloppy-imports Vyline/packages/protocol/stack/client/features/call
bun Vyline/apps/desktop/tests/serve-call-ui.ts
bun Vyline/apps/desktop/tests/serve-call-recordings.ts
```

UI harnessは`http://127.0.0.1:8768/lifecycle`、`/group`、`/modals`、`/panel`。`/panel?preview`で記録ボタン付きの通話ペインを確認できる。録画harnessは`http://127.0.0.1:8774/`で、Cookie必須の認証プロキシを模したガード、隔離された一時storage、本物の録画BFFを使用する。カメラ/マイク/LINE送信の代わりに合成媒体を使う。コード変更後はharnessサーバーを再起動する。

追加機能の全体検証はBun632成功/0失敗、全workspace型、root Lint、production build成功。既存の500KiB超bundle警告は残る。その後の補強テスト8件で実30秒idle timeout、WebDAV Range、Cookieによる取得と変更拒否も確認した。WebDAV fixtureはBun 1.4 Windowsのtest runner/socket併用時のクラッシュを避けて通常Bunの子プロセスで全assertを実行し、切断／stall peerは独立したNodeサーバーを使用する。

ブラウザーでは生成した440Hzマイク＋660Hz受信音の両成分、自分のミュートで440Hzだけが消えること、追加getUserMediaなし、終了時flush、自動の参加待ち／退出停止／再参加／手動停止、アカウント切替後の旧所有者保存と通知抑止を確認した。GUIの無期限設定・別ローカルパス選択後に実ファイルの配置も確認。通話ペインは320×480、320×640、768、1024、1440pxで横はみ出しなし。実NAS、20分の総期限、数時間連続録画、実スマートフォンのバックグラウンド録画は未検証。

実送信はAGENTS.mdとユーザーが明示したテスト先だけ。Android操作・私用チャットへの送信・媒体や鍵の保存を行わない。2参加者の実測と3人以上の合成テストを区別する。

標準部分の根拠: [RTP header/padding](https://www.rfc-editor.org/rfc/rfc3550.html#section-5.1)、[protobuf encoding](https://protobuf.dev/programming-guides/encoding/)、[zlib maxOutputLength](https://nodejs.org/api/zlib.html#class-options)、[dialog top layer/focus](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element)。
