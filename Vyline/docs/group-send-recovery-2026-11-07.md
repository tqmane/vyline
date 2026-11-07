# グループ・個人宛送信エラーの復旧判定

最終更新: 2026-11-07

## 概要

グループ宛の送信失敗を調査し、実際のRPCエラーでは暗号鍵の復旧判定が起動しない不具合を修正した。個人宛も送信者鍵の更新判定を共有していたため、通常送信と復旧を確認した。

## 前提

- メインと全4サブモジュールのorigin/mainをfetchしてから調査した。メインは`ee70885`を基点とする。
- protocolのメイン側固定値`d638290`とfetchしたmain`1523f64`は同じtreeであり、protocolのファイル・gitlinkは変更しない。
- サイドパネルで送信失敗表示を確認した。サーバーでは既存コンテナのログ等を読み取っただけで、ファイル・設定・コンテナの変更や再起動は行っていない。
- 実グループへの送信・再送・暗号鍵登録は行わない。テストのRPCと暗号処理は合成データのmockを使用する。

## 根拠

| 根拠 | 内容 |
| --- | --- |
| サーバーログ | 送信前の`getLastE2EEGroupSharedKey(/S4)`が`Request internal failed`で失敗している。ログはエラー詳細を秘匿するため、実際のcode値は未確認 |
| `protocol/stack/base/request/mod.ts`と`core/utils/error.ts` | `InternalError`の`message`は汎用文で、LINEの復旧コードは`data.code`に格納される |
| `backend/src/service/lineService.ts` | 既存判定は`error.message`だけを見ており、通常のRPCエラーでは鍵不在・sender更新・共有鍵再作成・明示的な平文指示を認識できない |
| `lineService.groupSend.test.ts` | 実際の`InternalError`形式で、従来コードの送信失敗を再現した。権限拒否や共有鍵再作成失敗で平文へ落ちるケースも再現した |

## 修正

- 既存の復旧コード`5/83/98/99`とsymbolic値だけを`data.code`から抽出する。エラー本文・秘密鍵・追加payloadを連結したりログへ公開したりしない。
- テキスト、単一メディア、バッチメディアの既存復旧処理で共通の判定を使用する。
- グループ送信のエラー後の平文再試行・平文キャッシュ追加は、LINEから明示的な`E2EE_RETRY_PLAIN`がある場合に限る。権限拒否・不明なエラー・鍵の再作成失敗・ローカル鍵不在だけでは暗号化を弱めない。メディアでは、エラーとは別にサーバーが指定する既定flowを維持する。
- 個人宛はグループ鍵取得を呼ばず、送信者鍵の更新後も暗号化して再試行する。明示的な平文指示と、相手がE2EE非対応と判明した場合の互換動作を維持する。ローカル自己鍵の欠落では平文へ切り替えたり、その判断を次回へキャッシュしたりしない。
- 暗号方式、認証、通話、既読送信の設定は変更しない。

## 検証

```powershell
bun test Vyline/backend/src/service/lineService.groupSend.test.ts
bun test Vyline/backend/src/service/lineService.directSend.test.ts
bun run typecheck
bun run lint
bun test
```

送信前の平文指示・鍵不在、送信中のsender更新・共有鍵更新、権限拒否、復旧失敗、個人宛の通常送信と互換動作を確認した。対象はグループ12・個人宛7の19ケースで、全体は1142件成功・失敗0。型チェック、lint、buildも成功した。サーバーへの修正版適用と、実アカウントでの成功確認は未実施。
