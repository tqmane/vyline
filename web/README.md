# Vyline Web

`web/` はそのまま配信する静的サイトです。ページ本文を生成する build step はありません。

- `index.html` — ランディングページ
- `docs/*/index.html` — Docs / Wiki 本文。各ページを直接編集します
- `assets/site.css` — LP / Docs の共通スタイル
- `assets/site.js` — Docs の navigation、検索、TOC、theme、code copy などの UI 補助
- `assets/mark.svg` — 共通 mark

## 編集方針

1. 変更するページの根拠を、現在の Compose、Dockerfile、実コード、submodule、既存の技術 docs から確認する。
2. 対応する HTML を直接編集する。
3. ページを追加・削除した場合だけ `assets/site.js` の navigation / search metadata を同期する。
4. LP の宣伝文句を Docs に持ち込まない。Docs は手順・仕様・制約を優先する。
5. Raspberry Pi や Android の検証端末を、Vyline 全体の対応条件として書かない。

GitHub Pages は `.github/workflows/pages.yml` から `web/` をそのまま artifact として公開します。Vercel でも Root Directory を `web/` にすれば build command なしで配信できます。
