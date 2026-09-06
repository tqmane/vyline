# 作成・回答ダイアログの画面外表示

## 原因と修正

実ページの `vy-screen-enter` は高さ0でtransformが残っていた。
配下のfixedオーバーレイがその親を基準に中央寄せされ、タイトルが画面外へ出ていた。
既存の5作成フォームとイベント回答・投票・くじ結果で共通の `ActionDialog` を使う。
ブラウザ標準の `dialog.showModal()` でtop layerへ出し、背景のinert化とフォーカス制御を利用する。

## 契約・検証

- タイトル/閉じる操作が画面内に残る。長いタイトルは2行まで見せ、完全な名前はaria-labelに保持。
- 本文だけスクロールし、320pxでも横スクロールを発生させない。
- 閉じる/Escape/背景クリックで閉じ、元の操作へフォーカスを返す。PlusMenuは削除される項目ではなく永続する＋へ戻す。
- API操作・送信仕様は変更しない。実際の作成や投稿を検証名目で行わない。

`bun run build` → `bun Vyline/apps/desktop/tests/serve-call-ui.ts` → `/modals`。
実際と同じtransform＋高さ0の親で5フォーム、長いタイトル、範囲、横幅、フォーカス復帰を検査。
すべてのAPIをブラウザテストページ内でmockし、実LINEへの送信は行わない。

参照: [HTML Standard: dialog](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element)。
