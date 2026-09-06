# グループ通話

対象の実測先は「てすたや」だけ。既存1対1通話の認証・暗号・音声と映像を維持する。

## 実装契約

- 接続は group route → PARTICIPATE → media-ready。拒否・不完全な交渉では in-call にしない。
- グループの有無を問い合わせてから初期ホストを決める。問い合わせ失敗を「通話なし」としない。
- 受信は SRTP認証/復号 → XRTP分離 → 各SSRCのEAS2/Opus復号。内側RTPは二重復号しない。
- RTPバージョン・padding・extension境界を検証する。XRTPは最大16 packet、各1600 bytes、総量を制限し、途中までの結果を不正入力から返さない。
- 音声は参加者ごとに独立したデコーダーと有界の時間軸を持ち、同時発話を直列再生しない。音声WSの既存モノラル契約は維持する。
- 会議通知はFULL/PARTIALとversionを扱い、UIDとsrc_listのSSRCを対応させる。離脱時に媒体と参加者状態を破棄する。
- 映像のpmap 7/4は通常pmap 2と同一視しない。native SVC wire契約を確認してから接続する。
- UIは参加者カードと既存CallVideoStageを再利用する。未受信・カメラOFFの状態を区別する。
- 外部への生パケット、音声/画像、認証/鍵、会議参加者一覧のログ保存は禁止。

## 根拠・確認順

Windows LINE ampkit 1.0.0.911（SHA256 AE3BECEC677C16E5EAA2AC2D830E63678DBE3862B71BEB9C615B5D1BF218DF79）:

- XRTP: mux 0x209400、demux 0x209ba0。PLD extension ID 3 の長さは上位2bitで1/2/4/8byteを指定するbig-endian整数。0はpadding。
- 音声: normal-audio pmap1 → EAS2 packetizer 0x239ce0。グループもraw Opusではない。
- 会議: conference_info 0xd849e8、member_info 0xd84898、member_srcid 0xd84618。
- 暗号: SRTP unprotect 0x6cd570 → RTP処理 → 音声XRTP demux/内側RTP。鍵の実際の選択は実通信で別途検証する。
- 標準RTP: [RFC 3550 §5.1](https://www.rfc-editor.org/rfc/rfc3550.html#section-5.1)。

まず境界/codec/複数SSRCの合成テスト、次に許可グループのWindows実通信。2人での実測を3人以上の実測とは扱わない。未検証の事項はtodoと最終docsに残す。

## PDTPの契約（受信経路・参加者UIへ接続済み、実通信の残確認あり）

`v62`は先頭2bitが幅を指定する1/2/4/8-byte big-endian整数。
RTP payloadは`PNの上位2または6bytes / serviceId NUL終端 / BE u16 bitmap / section群`。
PNは4/8-byte v62の末尾2bytesをRTP sequenceで補う。sectionはbitmapに存在する型を15→1の順で並べ、`byteLength:v62 / content`。
型1..5/12/13はcontent先頭にelementCount:v62がある。native builderの宣言byteLengthは`N + v62Width(N)`、実長は`N + v62Width(count)`（Nはelement合計長）。native readerは既知recordを構造解析する。この正確な2形式だけを許容し、不一致を無条件に許容しない。

| type | content |
|---|---|
| 1 DATA | streamId、flags、flagごとのlength付きmetadata、absolute offset、dataLength、data |
| 2 CLOSE | streamId、originator:u8、reason:NUL string |
| 3 CTRL | streamId、originator:u8、offset、ctrl、操作別情報（操作の詳細は未確定） |
| 4 OPEN | streamId、flags、startOffset |
| 5 RESET | streamId、originator:u8、syncOffset、reason:NUL string |
| 9 INCLUDE_RETRANS | originalPN |
| 10 SET_MAX_ACK_DELAY | delay |
| 11 SWITCH_ACK_ALL_STRM | enable |
| 12 REQUEST_MAX_RECEIVABLE | streamId |
| 13 UPDATE_MAX_RECEIVABLE | streamId、absoluteLimit |
| 15 ACK | largestPN、reason、reason5のみretransLate、ackDelay、pairCount、(gap,range)列 |

DATA flagsはbit7で追加flags byteあり。各set bitのmetadataをbit6→0順に読む。
40=latency、20=source offset、10=reliable、08=start、04=end、02=message、01=media timestamp。
単一reliable messageの基本flags=1eで、続く4個のmetadataLengthは0。開始から終了まで、同じservice/channel/streamの連続offsetを有界に連結する。

ACKのcount0はlargestだけの確認であり、過去全体の累積ACKではない。追加rangeは`high=cursor-gap-1`、`low=high-range+1`、次cursor=low。
ACK delayはnanoseconds。ACK-only bitmap4000にはACKを返さない。creditは残量ではなく絶対上限。native初期windowは327680 bytes。

notifierは`PLANET / stream1`。独立subscribeは未確認。完成message先頭からconf_msg_containerを解析し、comp_type=1ならmsgだけをzlib展開する。
group capability 4/5はPDTP_CONF_MSG/PDTP_CONF_MSG_XCAST。pdtpOndemandStreams `{1:4,2:2}`はstream4/maxCount2で、stream1購読ではない。

RTP channelは番号付きextensionではなく共通header。profile上位byte=02、下位flagsのlow4bitがcommonWordCount、10にsrc_channel、20にdst_channelがあり、BE u32でこの順に入る。
番号付き要素は共通word群の後。PDTPはdst_channelを使い、0240の既定は0だが、非zero channelも受理される。

RVA: PDTP parse/build 1a04a0/1a2b50、DATA 1a66d0/1a70f0、ACK 1a3a90/1a3e30、credit 1a41e0/1a4310、notifier 5b3200/59b8e0、RTP channel ee4d0/1a070c。
FULLはmember mapを全消去して再適用（5ed869/5ed876/5ed93d）。native keyはuid@svc_id。
PARTICIPATE contentsType 1はraw conference_info。compContentsType 1ならcontents全体を展開する。初期contentsの後にPDTP PARTIALを適用する。初回PARTIALも有効で、version 0は未バージョン化として扱う。
現在のparserは通常LINE MID単位であり、複数svc_idで同じUIDが現れる会議を対応済みとはしない。

## グループ映像の候補実装と検証境界

- 通常の無名conferenceはrosterのV sourceへchannel0で要求し、channel_infoがあれば明示対応を優先する。1要求のACKは5秒、最大30 source、退出はSTOP。更新中の最新変更を失わず、旧通話の完了を新通話へ持ち越さない。
- NOTIFY_STRMは現在のCID/MC channel/参加者/映像channelを照合する。購読ACK待ち中も既知conference channelで検査し、別channelから同じSSRCをpauseさせない。
- VP8Aの4-byte長を通常VP8の3-byte長へ変換し、raw VP8は変更しない。VFDなしのnative SVCでもPD extensions後の6-byte profileは必要。PDとprofileのSID/TID・codec・長さを照合する。
- 受信はSSRCごとに一つのspatial streamとその全temporal frameを保持し、他SIDを混合しない。Windows→Vylineの実受信と640×360ブラウザ描画は確認済み、逆方向の転送は未成立。
- WS v2は会議で検証済みMIDを付けた下り映像専用。v1の1対1/上りを変更せず、BFFは上りMIDを拒否する。
- 3人のdecoder/canvas分離・退出/遅着・4タイル一覧/固定をブラウザharnessで確認。映像表示中はcompact headerにして終了操作を画面内に残す。
- publisherのSTRM要求を受付ACKしてもカメラを自動ONにしない。受信者の要求前・STOP後は送らず、開始/codec変更後はkey frameを待つ。
