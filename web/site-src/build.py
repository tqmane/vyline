#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent
WEB_DIR = SOURCE_DIR.parent
PAGES_DIR = SOURCE_DIR / "pages"
CONTENT_PATH = SOURCE_DIR / "content.json"


def load_config() -> dict:
    return json.loads(CONTENT_PATH.read_text(encoding="utf-8"))


def apply_vars(value: str, config: dict) -> str:
    site = config["site"]
    return value.replace("{{repository}}", site["repository"]).replace("{{version}}", site["version"])


def render_home(config: dict) -> str:
    body = apply_vars((SOURCE_DIR / "home.html").read_text(encoding="utf-8"), config)
    description = "Vyline — Docker で動くセルフホスト可能な非公式サードパーティ LINE クライアント。"
    return f'''<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#090a09">
  <meta name="description" content="{html.escape(description, quote=True)}">
  <title>Vyline — self-hosted third-party LINE client</title>
  <link rel="icon" href="./assets/mark.svg" type="image/svg+xml">
  <link rel="stylesheet" href="./assets/site.css">
</head>
<body class="landing">
{body}
</body>
</html>
'''


def render_loader(page: dict, *, root: str) -> str:
    title = "Vyline Docs" if page["id"] == "overview" else f'{page["title"]} · Vyline Docs'
    return f'''<!doctype html>
<html lang="ja" data-page-id="{html.escape(page["id"], quote=True)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#ffffff">
  <meta name="description" content="{html.escape(page["lead"], quote=True)}">
  <title>{html.escape(title)}</title>
  <link rel="icon" href="{root}assets/mark.svg" type="image/svg+xml">
  <link rel="stylesheet" href="{root}assets/site.css">
  <script defer src="{root}assets/site.js"></script>
</head>
<body class="docs-page docs-loading">
  <main class="docs-loading-state" aria-live="polite">Vyline Docs</main>
  <noscript><p class="docs-noscript">このドキュメントの表示には JavaScript が必要です。</p></noscript>
</body>
</html>
'''


def render_redirect(target: str) -> str:
    target_url = f"../{target}"
    return f'''<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url={html.escape(target_url, quote=True)}">
  <link rel="canonical" href="{html.escape(target_url, quote=True)}">
  <title>移動しました · Vyline Docs</title>
</head>
<body><p><a href="{html.escape(target_url, quote=True)}">新しいページへ移動</a></p></body>
</html>
'''


def generated_files(config: dict) -> dict[Path, str]:
    outputs: dict[Path, str] = {Path("index.html"): render_home(config)}
    for page in config["pages"]:
        source = PAGES_DIR / f'{page["id"]}.html'
        if not source.is_file():
            raise FileNotFoundError(source)
        if page["slug"] == "":
            outputs[Path("docs/index.html")] = render_loader(page, root="../")
        else:
            outputs[Path("docs") / page["slug"] / "index.html"] = render_loader(page, root="../../")
    for slug, target in config.get("redirects", {}).items():
        outputs[Path("docs") / slug / "index.html"] = render_redirect(target)
    return outputs


def write_outputs(outputs: dict[Path, str]) -> None:
    for rel, content in outputs.items():
        path = WEB_DIR / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def stale_outputs(outputs: dict[Path, str]) -> list[str]:
    return [rel.as_posix() for rel, expected in outputs.items() if not (WEB_DIR / rel).exists() or (WEB_DIR / rel).read_text(encoding="utf-8") != expected]


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Vyline landing page and docs route files")
    parser.add_argument("--check", action="store_true", help="fail if generated route files are stale")
    args = parser.parse_args()
    outputs = generated_files(load_config())
    if args.check:
        stale = stale_outputs(outputs)
        if stale:
            print("Generated web route files are stale:")
            for path in stale:
                print(f"  {path}")
            return 1
        print(f"web route files are up to date ({len(outputs)} files)")
        return 0
    write_outputs(outputs)
    print(f"generated {len(outputs)} files under {WEB_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
