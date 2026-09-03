<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->
<!-- Language: en -->

[日本語](README.md)

# Vyline — tqmane fork

A self-hostable, unofficial third-party LINE client. The tqmane fork focuses on Docker/arm64 deployments, durable history and restore behavior, protocol tracking, and plugin/theme extensibility.

> [!CAUTION]
> Vyline is not an official or approved LINE client. Use it only if you understand the risks, including account restrictions, session breakage, and data loss.

## Documentation

The website under `web/` is a dependency-free static site. `web/index.html` is the landing page and `web/docs/` contains the documentation/wiki. The page content is checked in directly rather than generated.

- [`web/index.html`](web/index.html) — landing page
- [`web/docs/`](web/docs/) — Quick Start / configuration / host guides / operations / internals / development / troubleshooting
- [`docs/Vyline-Android-Docker-Complete-Guide-ja.md`](docs/Vyline-Android-Docker-Complete-Guide-ja.md) — detailed Android Docker validation notes (Japanese)

GitHub Pages publishes `web/` directly. On Vercel, set `web/` as the Root Directory; no build command is required.

## Quickstart

### Docker Compose

```bash
mkdir -p vyline && cd vyline
curl -LO https://raw.githubusercontent.com/tqmane/vyline/main/docker-compose.yml
docker compose pull
docker compose up -d
```

Open `http://<server-ip>:3000`. Persistent state is stored in `./data` and `./storage` by default; do not delete them during updates.

`ghcr.io/tqmane/vyline:latest` is a multi-arch image for `linux/amd64` and `linux/arm64`. The same tag works on ordinary 64-bit Linux hosts and arm64 SBCs. Using Android as a Docker host has additional kernel, chroot, and networking requirements.

### Portainer

1. Open **Stacks → Add stack → Web editor**.
2. Paste [`docker-compose.portainer.yml`](docker-compose.portainer.yml) and deploy it.
3. To update, pull the image and then update/redeploy the Stack so the container is recreated.

## Host guides

The Linux guide covers the Vyline steps shared by 64-bit Linux hosts that can run Docker. The Raspberry Pi page is not model-specific; it covers memory, storage, and always-on operation for arm64 SBCs. Android has separate kernel and networking pages because its Docker-host requirements differ from conventional Linux servers.

- Linux: [`web/docs/linux/`](web/docs/linux/)
- Raspberry Pi / SBC: [`web/docs/raspberry-pi/`](web/docs/raspberry-pi/)
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

The submodules are part of the effective system specification. Use Protocol as the source for LINE transport/E2EE behavior, Plugin for extension contracts, Themes for presets, and Tools for Desktop LINE tracking/research workflows.

## Main tqmane-fork changes

- On-demand history paging with stable scroll position while reading older messages.
- Durable Docker `data` / `storage`, bind-mount ownership repair, and stronger post-restore flushing.
- Selected work around Note/Album, LIFF sender metadata, token lifecycle, and unsend safeguards.
- Independent Protocol, Plugin, Themes, and reverse-engineering tool submodules.

## Configuration

Important host-side Compose settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VYLINE_BIND_ADDRESS` | `0.0.0.0` | host bind address |
| `VYLINE_PORT` | `3000` | published host port |
| `VYLINE_DATA_PATH` | `./data` | persistent application state |
| `VYLINE_STORAGE_PATH` | `./storage` | persistent cache/media storage |
| `VYLINE_LAN_ACCESS` | `false` | LAN/subdevice access model |
| `VYLINE_TRUST_REMOTE_OWNER` | `false` | explicit remote-owner trust bypass |
| `TZ` | `Asia/Tokyo` | timezone |

Treat [`.env.example`](.env.example) and the Compose files as the current source of truth.

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

Use Bun 1.4 or newer. For an existing clone with missing submodules, run `git submodule update --init --recursive`.

The Web Docs are not generated. Edit each HTML page under `web/` directly, and only update the navigation/search metadata in `web/assets/site.js` when pages are added or removed.

`README.src.md` is the editable README source.

```bash
bun run docs:readme
```

## Security

Do not expose Vyline, Portainer, the Docker socket, or LINE session/token material directly to the public Internet. Put an explicit access boundary in front, such as Cloudflare Access + Tunnel, Tailscale/WireGuard, or an authenticated reverse proxy.

Never commit `.env`, tokens/sessions, backups, account databases, `data/`, `storage/`, or E2EE key dumps.

## Upstream / License

Upstream: [nezumi0627/vyline](https://github.com/nezumi0627/vyline). Useful upstream changes are integrated selectively without overwriting intentional tqmane-fork behavior.

See [`LICENSE`](LICENSE) for license terms and attribution.
