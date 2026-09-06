# 通話レイアウト

## 契約

- 相手と自分の映像には薄い枠・名前を付ける。
- フォーカス表示の小窓はポインターで領域内を移動できる。6pxを超えるドラッグとタップを分離し、矢印キーで移動、Enter/Spaceで入替。
- 分割、3人以上での一覧、固定対象と表示順の選択を提供する。媒体要素の親・ref・streamを表示変更の際に再作成しない。
- 音声のみの場合は非表示の映像操作へフォーカスしない。短い画面で先頭を画面外に押し出さない。
- グループの合成表示テストとLINEでの複数参加者の実測は区別する。

## 実装

`apps/desktop/src/components/call-video-stage.tsx` は表示のみを担当する。
映像取得・送受信・終了処理は既存の `useCallVideo.ts` の責務を保つ。
参加者IDをキーにした固定した親要素にCSSの位置・order・gridを適用する。
現在の1対1はpeer/selfの2タイル。グループの実データ接続は別のgroup-callタスク。

## 検証

ルートで `bun run build` → `bun Vyline/apps/desktop/tests/serve-call-ui.ts`。
表示された `/lifecycle` でライフサイクル・入替・ドラッグ・分割・順序・合成4タイルの回帰テスト。
`/lifecycle?preview-controls` で実ポインター操作、`?preview-group` で合成4人の表示確認。
320/768/1024/1440px幅と短い横画面を確認する。これらは実カメラやLINE接続を使わない。

参照: [React: Preserving and resetting state](https://react.dev/learn/preserving-and-resetting-state)。
