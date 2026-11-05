# wemo

Local-only control of Belkin WeMo devices using [pywemo](https://github.com/pywemo/pywemo). No Belkin cloud or app required — your computer must be on the same network as the device.

## Usage

```sh
uv run wemo list                 # discover devices
uv run wemo status "Desk Lamp"   # name or IP; optional if you only have one
uv run wemo on  "Desk Lamp"
uv run wemo off 192.168.1.42
uv run wemo toggle
uv run wemo brightness "Hall" 40 # dimmers only
uv run wemo info "Desk Lamp"     # list the device's UPnP services/actions

# Crock-Pot
uv run wemo cook low 8h          # low for 8 hours
uv run wemo cook high 4h30m
uv run wemo cook warm
uv run wemo cook off
```

## Setting up a reset device (no app)

1. Factory reset the WeMo (hold the reset button ~5s while plugging in) so it broadcasts a `Wemo.XXX.XXX` Wi-Fi network.
2. Join that network from this computer.
3. `uv run wemo setup-wifi "YourSSID"` (prompts for the password; device defaults to 10.22.22.1).
4. Rejoin your normal Wi-Fi and run `uv run wemo list`.

Tip: give the device a DHCP reservation on your router so its IP stays stable.

## Web UI

A [Foldkit](https://foldkit.dev) front end lives in `web/`; `wemo serve` hosts it plus a JSON API.

```sh
cd web && pnpm install && pnpm build && cd ..   # one-time (rebuild after UI changes)
uv run wemo serve                               # http://localhost:8765
uv run wemo serve --host 0.0.0.0                # reach it from your phone on the LAN
```

For UI development with live reload, run `uv run wemo serve` and, in another terminal, `cd web && pnpm dev`. Vite proxies `/api` to port 8765.

The page polls every 5 seconds, so it stays in sync with changes made from the CLI or on the cooker itself.

API: `GET /api/devices`, `POST /api/scan`, `POST /api/devices/{id}/power|toggle|brightness|cook`, `GET /api/devices/{id}/info`, `POST /api/setup-wifi`.

## Docker (e.g. on a NAS)

The image [`jonstuebe/wemo-local`](https://hub.docker.com/r/jonstuebe/wemo-local) (`linux/amd64` and `linux/arm64`) bundles the built web UI and the server. Run it with **host networking** so WeMo discovery (SSDP multicast) can see your LAN; new devices then appear when you hit *Rescan network*, with no configuration. `WEMO_SCAN_SUBNETS` (e.g. `192.168.86.0/24`) additionally sweeps your LAN range over plain TCP, which finds devices even where multicast doesn't reach the container. `WEMO_HOSTS` is a last-resort list of specific device IPs.

On the NAS, with `compose.yaml` from this repo:

```sh
docker compose pull && docker compose up -d     # UI at http://<nas>:8765
```

Or without compose:

```sh
docker run -d --name wemo-local --restart unless-stopped --network host \
  -e WEMO_SCAN_SUBNETS=192.168.86.0/24 jonstuebe/wemo-local:latest
```

To build it yourself instead: `docker build -t jonstuebe/wemo-local:dev .`

Through Tailscale, open `http://<nas-tailscale-name>:8765`. There is no login, so anyone on your tailnet (or LAN) can control the devices.

Settings (environment variables): `WEMO_SCAN_SUBNETS` (comma-separated CIDR ranges to sweep), `WEMO_HOSTS` (comma-separated device IPs), `WEMO_PORT` (default 8765), `WEMO_BIND` (default `0.0.0.0` in the image).

Testing on a Mac: Docker (OrbStack/Docker Desktop) needs the macOS *Local Network* permission to reach LAN devices; restart OrbStack and accept the prompt if needed. Multicast discovery can't cross into the Mac's Docker VM even with host networking, so set `WEMO_SCAN_SUBNETS` there. Neither limitation applies to a Linux NAS.

## Releases

Every push to `main` is released automatically by [`.github/workflows/release.yml`](.github/workflows/release.yml), with the version worked out from [Conventional Commits](https://www.conventionalcommits.org) since the last `v*` tag:

| Commits since last release | Next version (below 1.0) | Next version (1.0 and up) |
| --- | --- | --- |
| `fix:` / `perf:` | 0.1.0 → 0.1.1 | 1.2.3 → 1.2.4 |
| `feat:` | 0.1.0 → 0.2.0 | 1.2.3 → 1.3.0 |
| `feat!:` / `BREAKING CHANGE:` footer | 0.1.0 → 0.2.0 | 1.2.3 → 2.0.0 |
| only `docs:` / `chore:` / `build:` / `ci:` / `test:` / `refactor:` | no release | no release |

A release pushes `jonstuebe/wemo-local:X.Y.Z`, `:X.Y` and `:latest`, then creates the `vX.Y.Z` git tag and GitHub Release with notes from the commits. Pull requests build the image without publishing. The workflow needs a `DOCKERHUB_TOKEN` repository secret (a Docker Hub access token with Read & Write access). `GET /api/health` reports the running version.
