# 通話・ビデオ通話の実装

更新: 2026-09-07。以下はPR44の配布前検証の記録。配布後の結果は[PR44の確認記録](https://github.com/tqmane/vyline/pull/44)を参照する。配布状況と、方向別の実通信確認を区別する。

## 検証・配布状況

| 範囲 | 状態 |
|---|---|
| 1対1音声・着信応答 | Windows LINEとの実通信確認済み |
| 1対1 VP8映像・音声からの切替 | PR41で配布。Windows LINEと公開ブラウザの双方向映像を確認 |
| 小窓の移動・入替・枠・分割・一覧 | PR42で配布。媒体DOMを維持する回帰テスト、実ブラウザ操作を確認 |
| 5種類の作成ダイアログ | PR42で配布。公開ページと320px幅・低い画面で確認。作成/送信自体はテストしていない |
| グループ音声の経路・XRTP・SSRC別ミキサー | PR43で配布。Vyline→Windowsの合成音をnative PCMまで確認。Android→Vylineは通常の仮想マイク入力とミュート・再開を実測。複数人同時発話は合成テストのみ |
| 会議通知のFULL/PARTIAL解析 | PR43で配布。PDTP受信・ACK/credit・初期一覧へ接続。指定グループの実参加者2人、UIへの状態通知を確認 |
| グループ映像 | PR43で受信実装を配布。Windows→Vylineの640×360ブラウザ表示を実測。作業版ではAndroid 26.14.0と双方向の映像伝送、Android側で送信テスト映像の表示・継続更新を確認。送信修正は未配布 |

配布版は`8d3480c`、Protocolは`131f83d`。CI・Security Scan・ARM64コンテナ生成が成功し、サーバーの正常起動を確認した。既存のdata/storage保存先、Compose設定、他コンテナは維持した。配布完了を双方向の実通信完了とは扱わない。

### 2026-09-07の送信修正（未配布）

- グループのVIDEO指定を参加offer・通話種別・service IDへ反映する。
- 生成済みのVFDをRTP拡張へ渡す。下りパケットで拡張が省略されても、上りの省略はできない。拡張なしではLINE受信入口にVIDEOが現れず、追加後はSRTP認証まで進むことを比較確認した。
- VFDのB/Eは圧縮レイヤー配列の先頭/末尾を表す。単一レイヤーでは全RTP断片で両方を立てる。EVS3 PDのbegin/end・RTP markerとは別の意味であり、受信検証でも一致を要求しない。Android 26.14.0の`vns_evs_rtp_xtn_ctx_build_vfd`（0x866b14、境界判定0x866cb4）とv1 encoder（0x88bbf0）で確認した。末尾BE16はレイヤーごとのパケット連番。
- 2つのVFD修正後、同一グループのAndroid側で観測区間中656個のVIDEOパケットが認証に成功し、429回のデコード成功と画面の継続更新を確認。65秒の参加ではVylineが885フレームを実送信し、Androidの仮想カメラから647フレームを受信した。実画像・音声・鍵値は保存していない。
- Androidの録音入力へ6秒間の660Hz合成音を一時的に渡し、LINE→実サーバー→Vylineで324フレーム・311,040サンプルを復号。660Hz成分が約96%を占めることを確認した。音声・映像同時の65秒参加でも338音声フレーム、614映像フレームを受信し、885映像フレームを送信した。
- 上記の合成音検証時は通常マイクと公式gRPC注入が無音だった。その後、Windowsの既定入力をVoicemeeter Out B1と確認し、Pixel_9を`-no-snapshot-load -allow-host-audio -camera-front webcam0`で再起動。通常入力でLINEのOpus入力が非ゼロとなり、XSplit Broadcasterに対応するwebcam0の映像も表示された。ホスト入力許可・再起動を同時に変更したため、無音の原因をどちらか一方に断定していない。AVDのデータやWindows既定デバイスは変更していない。
- 合成音注入なしの65秒ビデオ通話で、Android→Vylineの3,242 PCMフレーム・3,112,320サンプル（peak 11,809）と649映像フレームを受信し、Vylineから885映像フレームを実送信。XSplit映像を実ブラウザの通話overlayに描画した。別の音声専用通話では2,142 PCMフレームを受信し、マイクOFFで受信が無音・停止、ONで再開することを5秒単位の集計で確認。実音声・映像は保存していない。
- グループのビデオ通話入口を有効化。通常画面経由の配布後確認、Windowsでの送信修正後確認は別途検証する。

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

`CallSession.start()`は作業ブランチで同じ開始Promiseを共有する。失敗後の再呼び出しで古いルートを成功として返さず、接続処理中に終了された通話を`in-call`へ戻さない。

## 音声

ブラウザとBFFの音声は48kHz/mono/16-bit PCM。Opus符号化はサーバー側で行う。PLANETのnormal-audio（pmap 1）のpayloadはraw OpusではなくEAS2なので、`planet/eas2.ts`で変換する。

1対1は20msフレーム。作業中のグループ経路は20ms Opusを2個まとめ、宣言した40ms ptimeのEAS2を作る。CELTのspeech mask、異なるTOC設定、可変長フレームを維持する。古い録画済みDATA/RTCPパケット列の再送は除去した。

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

作業ブランチではHTTPのstatus/endにもアカウント一致検査を追加し、不一致は404とする。開始前のルート取得中もアカウントを予約して、同時発信/着信応答が競合しないようにした。再試行によって別のグループを勝手に作らない。

## 表示

`call-video-stage.tsx`は同じ媒体DOMを維持し、CSSの位置・順序・gridだけを変える。薄い枠と名前で映像範囲を示し、フォーカス/分割/一覧、表示対象の固定、小窓のドラッグとタップ入替に対応する。ドラッグ後のclickとキーボード操作は区別する。

4タイルの一覧/固定表示は合成harnessで検証済み。1対1の自分/相手に加え、PR43でグループの実hookと参加者別canvasを接続した。3人の独立decoder、離脱した人の遅着破棄をブラウザで確認した。320/768/1024/1440pxと640x360で終了ボタンを画面内に残す。映像待ちでも大きな通話アイコンをヘッダーに重複表示しない。参加者が遅れて届いても、ユーザーが固定を選んでいなければ空の自分タイルを主表示に固定しない。

グループ音声は参加者カードを使い、一覧だけをスクロールする。取得前・長い名前・12人・自分のミュートを検証した。相手のstream存在を「マイクON」とは表示しない。

参加者通知は既存HTTP/WS状態のoptional `participants`として配信し、媒体SSRCはブラウザへ渡さない。CallSessionは離脱した音声sourceのcodec/bufferを破棄し、その後の遅着を再生しない。アカウント切替ではCallControllerを再作成し、遅れて完了した旧発信は終了する。旧WebSocketの通知で新しい通話を上書きしない。

作成ダイアログは`action-dialog.tsx`のnative `<dialog>.showModal()`を共有する。transformを持つ親要素からtop layerへ出し、タイトル/閉じる操作を固定、本文だけをスクロールする。Escapeや閉じる操作で元のボタンへfocusを戻す。

## グループのnative根拠と残作業

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
- 送信候補はnative実測に合わせたprofile 0x0200、単一SID2/TID1とtype8 base descriptor。SID番号とresolution classは別の値であり、解像度をSIDから推測しない。送信のserver転送はまだ成立していないため、この候補を動作確認済みとは扱わない。

実測（指定グループ、Windowsマイク/カメラOFF）: Vylineから短い440Hz合成音を送信。WindowsでSRTP音声224 packetを認証し、XRTP内側225 packetを処理。native decoderで499 PCM frame / 479040 samples / 48kHzを確認し、peak 0.0341、クリッピングなし。合成音の数値集計のみで、PCMや鍵は保存していない。逆方向はまだ実測していない。

グループ映像の追加実測: pmap7・VFD v1・PT121が交渉され、Windowsから約146 frame/10秒を受信・再構成。25秒の受信では358 frameを既存useCallVideo/CallOverlayへ流し、実WebCodecs decoderと640×360 canvas表示を確認した（保存なし、ブラウザ警告/例外なし）。一方、合成映像を90/300 frame送ってもWindows側のVIDEO SRTP受信は0。双方向成功とは扱わない。

配布後の比較: 正しい参加判定を反映してもWindowsへの映像は未到達。nativeの復号前入口でもPT121を確認できなかった。native独自のCCFS_FB2受信報告では、通常の送信先へのVIDEOパケット受信が報告されたが、これはSRTP認証成功の証明ではない。最初のbridgeへ映像の送信先を固定すると、この受信報告も0になった。遅延測定要求への応答をローカル試験で追加しても映像転送は改善せず、これらの比較用処理は製品コードへ入れていない。

作業中・未配布: グループ参加信号が音声固定だったため、VIDEO指定時のcommTypeFlags=3、groupcall.video、V初期状態=1を接続した。音声/ビデオの分岐をRED→GREENで検証したが、初期ビデオ参加でもWindowsへの映像は未到達。初期発信ボタンは実通信完了前のため無効のまま。

残作業: Windows→Vylineのグループ音声、Vyline→Windowsの映像送信、開始/停止/退出を通した実測。`getGroupCall`失敗を「通話なし」に変換する処理は禁止。

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
```

UI harnessは`http://127.0.0.1:8768/lifecycle`、`/group`、`/modals`。`/lifecycle?preview-group-call`で通話本体の4タイルを確認できる。カメラ/マイク/外部送信の代わりに合成媒体を使う。コード変更後はharnessサーバーを再起動する。

実送信はAGENTS.mdとユーザーが明示したテスト先だけ。Android操作・私用チャットへの送信・媒体や鍵の保存を行わない。2参加者の実測と3人以上の合成テストを区別する。

標準部分の根拠: [RTP header/padding](https://www.rfc-editor.org/rfc/rfc3550.html#section-5.1)、[protobuf encoding](https://protobuf.dev/programming-guides/encoding/)、[zlib maxOutputLength](https://nodejs.org/api/zlib.html#class-options)、[dialog top layer/focus](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element)。
