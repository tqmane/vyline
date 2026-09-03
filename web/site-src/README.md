# Vyline Web Docs source

公開物は依存ゼロの静的HTMLです。Vercelの Root Directory を `web/` にすればそのまま配信できます。

## 再生成

```bash
python3 scripts/build-web-docs.py
```

- `scripts/build-web-docs.py`: ページ本文・ナビ・HTML生成の正本
- `web/site-src/content.json`: 検索/一覧用ページメタデータ
- `web/site-src/build.py`: 再生成エントリポイント
- `web/assets/site.css`: LP / Docs共通デザイン
- `web/assets/site.js`: Docs検索、テーマ、目次、コードコピー、モバイルメニュー
- `web/docs/`: 生成済みWiki/Docs

Android完全版の原稿は `docs/Vyline-Android-Docker-Complete-Guide-ja.md` を正本として、build時に内蔵のMarkdown変換器でWebページへ変換します（pandoc不要）。
