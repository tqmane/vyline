<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->
<!-- Language: ja -->

[English](README.en.md)

# Vyline — tqmane fork

LINE を自分の環境で扱うための、セルフホスト可能な非公式サードパーティクライアントです。tqmane fork では Docker / arm64 運用、履歴・復元の永続化、Protocol追従、Plugin / Theme 基盤などを強化しています。

> [!CAUTION]
> Vyline は LINE 公式・承認済みクライアントではありません。アカウント停止、セッション破損、データ損失などのリスクを理解した上で利用してください。

## Documentation

新しい Web Docs / Wiki を `web/` に用意しています。トップページはランディングページ、その先の `/docs/` は一般的な Wiki / Docs 構成です。

- [`web/index.html`](web/index.html) — ランディングページ / landing page
- [`web/docs/`](web/docs/) — Quick Start / Linux / Raspberry Pi / Android / Architecture / Protocol / Troubleshooting / A–Z Index
- [`docs/Vyline-Android-Docker-Complete-Guide-ja.md`](docs/Vyline-Android-Docker-Complete-Guide-ja.md) — Android Docker 完全構築ガイド

Vercel では `web/` を Root Directory にすると、依存なしの静的サイトとしてそのまま配信できます。

## Quick Start

### Docker Compose

```bash
mkdir -p vyline && cd vyline
curl -LO https://raw.githubusercontent.com/tqmane/vyline/main/docker-compose.yml
docker compose pull
docker compose up -d
```

ブラウザで `http://<server-ip>:3000` を開きます。既定では `./data` と `./storage` が永続化されます。更新時に削除しないでください。

`ghcr.io/tqmane/vyline:latest` は `linux/amd64` / `linux/arm64` の multi-arch image です。通常の64-bit Linux、64-bit Raspberry Pi、適切に構築したarm64 Android Docker hostで同じtagを利用できます。

### Portainer

1. **Stacks → Add stack → Web editor** を開く。
2. [`docker-compose.portainer.yml`](docker-compose.portainer.yml) を貼り付けて Deploy。
3. 更新時は **Pull latest image → Update / Redeploy stack**。

## Host guides

Linux はディストリビューションごとに Docker 導入・サービス管理・SELinux/AppArmor・firewall が違うため、一括りにはしていません。Web Docs では Debian/Ubuntu、Fedora/RHEL/CentOS系、Arch系、openSUSE、Alpineを分けて説明しています。

- Linux: [`web/docs/linux/`](web/docs/linux/)
- Raspberry Pi: [`web/docs/raspberry-pi/`](web/docs/raspberry-pi/)
- Android Docker host: [`web/docs/android/`](web/docs/android/)
- Android kernel: [`web/docs/android-kernel/`](web/docs/android-kernel/)
- Android networking: [`web/docs/android-network/`](web/docs/android-network/)

## Repository architecture

```text
Browser
  ↓
Vyline/apps/desktop
  ↓
Vyline/backend
  ↓
Vyline/packages/protocol  (submodule: vyline-api)
  ↓
LINE services

Vyline/packages/plugin    (submodule: vyline-plugin)
Vyline/packages/themes    (submodule: vyline-theme)
tools                     (submodule: vyline-search)
```

### Submodules

| Path | Repository | Role |
| --- | --- | --- |
| `Vyline/packages/protocol` | `tqmane/vyline-api` | login / transport / RPC / E2EE / Talk domain |
| `Vyline/packages/plugin` | `tqmane/vyline-plugin` | plugin SDK / permissions / examples |
| `Vyline/packages/themes` | `tqmane/vyline-theme` | `VyTheme` type and theme presets |
| `tools` | `tqmane/vyline-search` | Desktop LINE version tracking, unpack, xref and decompile tooling |

サブモジュールも本体仕様の一部です。通信やE2EEはProtocol、拡張APIはPlugin、見た目のpresetはThemes、Desktop更新追従はToolsを正本として確認してください。

## Main tqmane-fork changes

- 必要時だけ履歴を追加取得する同期設計と、過去ログ閲覧時のスクロール維持。
- Docker の `data` / `storage` 永続化、bind-mount ownership repair、復元後flush強化。
- Note / Album、LIFF sender metadata、token lifecycle、unsend保護などの追従。
- 独立Protocol / Plugin / Themes / reverse-engineering tools submodule。

## Configuration

Compose の主なhost-side設定:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VYLINE_BIND_ADDRESS` | `0.0.0.0` | host bind address |
| `VYLINE_PORT` | `3000` | published host port |
| `VYLINE_DATA_PATH` | `./data` | persistent application state |
| `VYLINE_STORAGE_PATH` | `./storage` | persistent cache/media storage |
| `VYLINE_LAN_ACCESS` | `false` | LAN/subdevice access model |
| `VYLINE_TRUST_REMOTE_OWNER` | `false` | explicit remote-owner trust bypass |
| `TZ` | `Asia/Tokyo` | timezone |

完全な現行値は [`.env.example`](.env.example) と Compose file を正本にしてください。

## Development

```bash
git clone --recurse-submodules https://github.com/tqmane/vyline.git
cd vyline
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build
```

Bun 1.4 以降を使用します。既存cloneでsubmoduleが空なら `git submodule update --init --recursive` を実行してください。

Web Docs の生成物を更新する場合:

```bash
python3 scripts/build-web-docs.py
```

README は `README.src.md` が編集元です。

```bash
bun run docs:readme
```

## Security

Vyline、Portainer、Docker socket、LINE session/tokenを認証なしでInternetへ公開しないでください。外部アクセスはCloudflare Access + Tunnel、Tailscale/WireGuard、認証済みreverse proxy等で明示的な境界を作ってください。

`.env`、token/session、backup、account DB、`data/`、`storage/`、E2EE key dumpをcommitしないでください。

## Upstream / License

Upstream: [nezumi0627/vyline](https://github.com/nezumi0627/vyline). tqmane fork の意図的な差分を維持しながら、有用なupstream変更を選択的に取り込みます。

ライセンスと attribution は [`LICENSE`](LICENSE) を参照してください。
