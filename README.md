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

The image `wemo-local` bundles the built web UI and the server. Run it with **host networking** so WeMo discovery (SSDP multicast) can see your LAN; new devices then appear when you hit *Rescan network*, with no configuration. `WEMO_SCAN_SUBNETS` (e.g. `192.168.86.0/24`) additionally sweeps your LAN range over plain TCP, which finds devices even where multicast doesn't reach the container. `WEMO_HOSTS` is a last-resort list of specific device IPs.

On the NAS, from a copy of this folder:

```sh
docker compose up -d --build      # UI at http://<nas>:8765
```

Or build on your Mac and copy the image over (most NAS boxes are `linux/amd64`):

```sh
docker buildx build --platform linux/amd64 -t wemo-local:latest --load .
docker save wemo-local:latest | ssh <nas> docker load
```

Then on the NAS, run `docker compose up -d` with `compose.yaml`, or:

```sh
docker run -d --name wemo-local --restart unless-stopped --network host wemo-local:latest
```

Through Tailscale, open `http://<nas-tailscale-name>:8765`. There is no login, so anyone on your tailnet (or LAN) can control the devices.

Settings (environment variables): `WEMO_SCAN_SUBNETS` (comma-separated CIDR ranges to sweep), `WEMO_HOSTS` (comma-separated device IPs), `WEMO_PORT` (default 8765), `WEMO_BIND` (default `0.0.0.0` in the image).

Testing on a Mac: Docker (OrbStack/Docker Desktop) needs the macOS *Local Network* permission to reach LAN devices; restart OrbStack and accept the prompt if needed. Multicast discovery can't cross into the Mac's Docker VM even with host networking, so set `WEMO_SCAN_SUBNETS` there. Neither limitation applies to a Linux NAS.
