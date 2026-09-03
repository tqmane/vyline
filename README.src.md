<!--@languages=ja,en-->
<!--@default=ja-->
[English](README.en.md)<!--ja-->
[日本語](README.md)<!--en-->

# Vyline — tqmane fork

LINE を自分の環境で扱うための、セルフホスト可能な非公式サードパーティクライアントです。tqmane fork では Docker / arm64 運用、履歴・復元の永続化、Protocol追従、Plugin / Theme 基盤などを強化しています。<!--ja-->
A self-hostable, unofficial third-party LINE client. The tqmane fork focuses on Docker/arm64 deployments, durable history and restore behavior, protocol tracking, and plugin/theme extensibility.<!--en-->

> [!CAUTION]
> Vyline は LINE 公式・承認済みクライアントではありません。アカウント停止、セッション破損、データ損失などのリスクを理解した上で利用してください。<!--ja-->
> Vyline is not an official or approved LINE client. Use it only if you understand the risks, including account restrictions, session breakage, and data loss.<!--en-->

## Documentation

新しい Web Docs / Wiki を `web/` に用意しています。トップページはランディングページ、その先の `/docs/` は一般的な Wiki / Docs 構成です。<!--ja-->
The new Web Docs / Wiki lives under `web/`: a product landing page at the root and a conventional documentation/wiki experience under `/docs/`.<!--en-->

- [`web/index.html`](web/index.html) — ランディングページ / landing page
- [`web/docs/`](web/docs/) — Quick Start / Linux / Raspberry Pi / Android / Architecture / Protocol / Troubleshooting / A–Z Index
- [`docs/Vyline-Android-Docker-Complete-Guide-ja.md`](docs/Vyline-Android-Docker-Complete-Guide-ja.md) — Android Docker 完全構築ガイド<!--ja-->
- [`docs/Vyline-Android-Docker-Complete-Guide-ja.md`](docs/Vyline-Android-Docker-Complete-Guide-ja.md) — complete Android Docker host guide (Japanese)<!--en-->

Vercel では `web/` を Root Directory にすると、依存なしの静的サイトとしてそのまま配信できます。<!--ja-->
On Vercel, set `web/` as the Root Directory to serve the dependency-free static site directly.<!--en-->

## Quick Start

### Docker Compose

```bash
mkdir -p vyline && cd vyline
curl -LO https://raw.githubusercontent.com/tqmane/vyline/main/docker-compose.yml
docker compose pull
docker compose up -d
```

ブラウザで `http://<server-ip>:3000` を開きます。既定では `./data` と `./storage` が永続化されます。更新時に削除しないでください。<!--ja-->
Open `http://<server-ip>:3000`. Persistent state is stored in `./data` and `./storage` by default; do not delete them during updates.<!--en-->

`ghcr.io/tqmane/vyline:latest` は `linux/amd64` / `linux/arm64` の multi-arch image です。通常の64-bit Linux、64-bit Raspberry Pi、適切に構築したarm64 Android Docker hostで同じtagを利用できます。<!--ja-->
`ghcr.io/tqmane/vyline:latest` is a multi-arch image for `linux/amd64` and `linux/arm64`, covering ordinary 64-bit Linux hosts, 64-bit Raspberry Pi systems, and correctly prepared arm64 Android Docker hosts.<!--en-->

### Portainer

1. **Stacks → Add stack → Web editor** を開く。<!--ja-->
1. Open **Stacks → Add stack → Web editor**.<!--en-->
2. [`docker-compose.portainer.yml`](docker-compose.portainer.yml) を貼り付けて Deploy。<!--ja-->
2. Paste [`docker-compose.portainer.yml`](docker-compose.portainer.yml) and deploy it.<!--en-->
3. 更新時は **Pull latest image → Update / Redeploy stack**。<!--ja-->
3. For updates, use **Pull latest image → Update / Redeploy stack**.<!--en-->

## Host guides

Linux はディストリビューションごとに Docker 導入・サービス管理・SELinux/AppArmor・firewall が違うため、一括りにはしていません。Web Docs では Debian/Ubuntu、Fedora/RHEL/CentOS系、Arch系、openSUSE、Alpineを分けて説明しています。<!--ja-->
Linux is not treated as one uniform platform: the Web Docs separate Debian/Ubuntu, Fedora/RHEL/CentOS-family systems, Arch-family systems, openSUSE, and Alpine because Docker installation, service management, MAC, and firewall behavior differ.<!--en-->

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

サブモジュールも本体仕様の一部です。通信やE2EEはProtocol、拡張APIはPlugin、見た目のpresetはThemes、Desktop更新追従はToolsを正本として確認してください。<!--ja-->
The submodules are part of the effective system specification. Use Protocol as the source for LINE transport/E2EE behavior, Plugin for extension contracts, Themes for presets, and Tools for Desktop LINE tracking/research workflows.<!--en-->

## Main tqmane-fork changes

- 必要時だけ履歴を追加取得する同期設計と、過去ログ閲覧時のスクロール維持。<!--ja-->
- On-demand history paging with stable scroll position while reading older messages.<!--en-->
- Docker の `data` / `storage` 永続化、bind-mount ownership repair、復元後flush強化。<!--ja-->
- Durable Docker `data` / `storage`, bind-mount ownership repair, and stronger post-restore flushing.<!--en-->
- Note / Album、LIFF sender metadata、token lifecycle、unsend保護などの追従。<!--ja-->
- Selected work around Note/Album, LIFF sender metadata, token lifecycle, and unsend safeguards.<!--en-->
- 独立Protocol / Plugin / Themes / reverse-engineering tools submodule。<!--ja-->
- Independent Protocol, Plugin, Themes, and reverse-engineering tool submodules.<!--en-->

## Configuration

Compose の主なhost-side設定:<!--ja-->
Important host-side Compose settings:<!--en-->

| Variable | Default | Purpose |
| --- | --- | --- |
| `VYLINE_BIND_ADDRESS` | `0.0.0.0` | host bind address |
| `VYLINE_PORT` | `3000` | published host port |
| `VYLINE_DATA_PATH` | `./data` | persistent application state |
| `VYLINE_STORAGE_PATH` | `./storage` | persistent cache/media storage |
| `VYLINE_LAN_ACCESS` | `false` | LAN/subdevice access model |
| `VYLINE_TRUST_REMOTE_OWNER` | `false` | explicit remote-owner trust bypass |
| `TZ` | `Asia/Tokyo` | timezone |

完全な現行値は [`.env.example`](.env.example) と Compose file を正本にしてください。<!--ja-->
Treat [`.env.example`](.env.example) and the Compose files as the current source of truth.<!--en-->

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

Bun 1.4 以降を使用します。既存cloneでsubmoduleが空なら `git submodule update --init --recursive` を実行してください。<!--ja-->
Use Bun 1.4 or newer. For an existing clone with missing submodules, run `git submodule update --init --recursive`.<!--en-->

Web Docs の生成物を更新する場合:<!--ja-->
To rebuild the generated Web Docs:<!--en-->

```bash
python3 scripts/build-web-docs.py
```

README は `README.src.md` が編集元です。<!--ja-->
`README.src.md` is the editable README source.<!--en-->

```bash
bun run docs:readme
```

## Security

Vyline、Portainer、Docker socket、LINE session/tokenを認証なしでInternetへ公開しないでください。外部アクセスはCloudflare Access + Tunnel、Tailscale/WireGuard、認証済みreverse proxy等で明示的な境界を作ってください。<!--ja-->
Do not expose Vyline, Portainer, the Docker socket, or LINE session/token material directly to the public Internet. Put an explicit access boundary in front, such as Cloudflare Access + Tunnel, Tailscale/WireGuard, or an authenticated reverse proxy.<!--en-->

`.env`、token/session、backup、account DB、`data/`、`storage/`、E2EE key dumpをcommitしないでください。<!--ja-->
Never commit `.env`, tokens/sessions, backups, account databases, `data/`, `storage/`, or E2EE key dumps.<!--en-->

## Upstream / License

Upstream: [nezumi0627/vyline](https://github.com/nezumi0627/vyline). tqmane fork の意図的な差分を維持しながら、有用なupstream変更を選択的に取り込みます。<!--ja-->
Upstream: [nezumi0627/vyline](https://github.com/nezumi0627/vyline). Useful upstream changes are integrated selectively without overwriting intentional tqmane-fork behavior.<!--en-->

ライセンスと attribution は [`LICENSE`](LICENSE) を参照してください。<!--ja-->
See [`LICENSE`](LICENSE) for license terms and attribution.<!--en-->
