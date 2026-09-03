# Vyline Web

`web/` はランディングページと Docs の静的サイトです。

## 構成

- `site-src/home.html` — ランディングページ本文
- `site-src/pages/*.html` — Docs 本文
- `site-src/content.json` — バージョン、ナビゲーション、旧 URL の redirect
- `site-src/build.py` — LP と Docs の route HTML を生成
- `assets/site.css` — LP / Docs 共通 CSS
- `assets/site.js` — Docs shell、検索、TOC、mobile nav、code copy

Docs の本文は `site-src/pages/` を正本とし、各 `docs/**/index.html` は軽量な route file です。表示時に `site.js` が本文とナビゲーションを読み込みます。これにより、同じ説明を generator と生成 HTML の二重で管理しません。

## 生成

```bash
python3 web/site-src/build.py
```

生成済み route file が source と一致しているかだけ確認する場合:

```bash
python3 web/site-src/build.py --check
```

互換用に次でも同じ builder を呼び出せます。

```bash
python3 scripts/build-web-docs.py
```

外部ライブラリや pandoc は使いません。
