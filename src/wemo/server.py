"""HTTP API around pywemo, plus static hosting for the built web UI."""

from __future__ import annotations

import ipaddress
import logging
import os
import socket
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal

import pywemo
import requests
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pywemo import CrockPot, CrockPotMode, Dimmer, WeMoDevice
from pywemo.discovery import device_from_uuid_and_location
from pywemo.ouimeaux_device import PROBE_PORTS
from pywemo.ouimeaux_device.api.xsd_types import DeviceDescription

LOG = logging.getLogger("wemo")

WEB_DIST = Path(
    os.environ.get("WEMO_WEB_DIST", Path(__file__).resolve().parents[2] / "web" / "dist")
)

# Comma-separated IPs/hostnames to load directly, for networks where SSDP
# multicast discovery can't reach the devices (e.g. Docker bridge networking).
STATIC_HOSTS = [h.strip() for h in os.environ.get("WEMO_HOSTS", "").split(",") if h.strip()]

# Comma-separated CIDR ranges (e.g. "192.168.86.0/24") to sweep for WeMo
# devices over plain TCP. Finds new devices without listing each one, and
# works where multicast can't reach the container (Docker on macOS, bridge
# networks, devices on another VLAN).
SCAN_SUBNETS = [
    ipaddress.ip_network(s.strip(), strict=False)
    for s in os.environ.get("WEMO_SCAN_SUBNETS", "").split(",")
    if s.strip()
]


def _is_port_open(target: tuple[str, int]) -> bool:
    try:
        with socket.create_connection(target, timeout=0.5):
            return True
    except OSError:
        return False


def _load_if_wemo(ip: str, port: int) -> WeMoDevice | None:
    url = f"http://{ip}:{port}/setup.xml"
    try:
        description = DeviceDescription.from_xml(requests.get(url, timeout=3).content)
    except Exception:
        return None  # some other UPnP device on that port
    return device_from_uuid_and_location(description.udn, url)


def sweep_subnets() -> list[WeMoDevice]:
    targets = [(str(ip), port) for net in SCAN_SUBNETS for ip in net.hosts() for port in PROBE_PORTS]
    with ThreadPoolExecutor(max_workers=256) as pool:
        open_targets = [t for t, is_open in zip(targets, pool.map(_is_port_open, targets)) if is_open]
        devices = list(pool.map(lambda t: _load_if_wemo(*t), open_targets))
    unique: dict[str, WeMoDevice] = {}
    for d in devices:
        if d is not None:
            unique.setdefault(d.udn, d)
    return list(unique.values())

CROCKPOT_MODES = {
    CrockPotMode.OFF: "Off",
    CrockPotMode.WARM: "Warm",
    CrockPotMode.LOW: "Low",
    CrockPotMode.HIGH: "High",
}


class Registry:
    """Discovered devices, keyed by UDN. pywemo is blocking, so guard with a lock."""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.devices: dict[str, WeMoDevice] = {}
        self.scanned = False

    def scan(self) -> None:
        found = pywemo.discover_devices()
        known = {d.udn for d in found}
        if SCAN_SUBNETS:
            for device in sweep_subnets():
                if device.udn not in known:
                    found.append(device)
                    known.add(device.udn)
        for host in STATIC_HOSTS:
            try:
                url = pywemo.setup_url_for_address(host)
                device = pywemo.device_from_description(url) if url else None
            except Exception:
                LOG.exception("Failed to load WeMo device at %s", host)
                continue
            if device is None:
                LOG.warning("No WeMo device answered at %s", host)
            elif device.udn not in known:
                found.append(device)
                known.add(device.udn)
        with self.lock:
            for d in found:
                self.devices[d.udn] = d
            self.scanned = True

    def all(self) -> list[WeMoDevice]:
        if not self.scanned:
            self.scan()
        with self.lock:
            return sorted(self.devices.values(), key=lambda d: d.name.lower())

    def get(self, device_id: str) -> WeMoDevice:
        if not self.scanned:
            self.scan()
        with self.lock:
            device = self.devices.get(device_id)
        if device is None:
            raise HTTPException(404, f"Unknown device {device_id}")
        return device


registry = Registry()


def serialize(d: WeMoDevice) -> dict:
    base = {
        "id": d.udn,
        "name": d.name,
        "model": d.model_name,
        "host": d.host,
        "port": d.port,
        "serial": d.serial_number,
        "firmware": d.firmware_version,
    }
    state = d.get_state(force_update=True)
    if isinstance(d, CrockPot):
        return {
            "_tag": "CrockPot",
            **base,
            "mode": CROCKPOT_MODES.get(d.mode, "Off"),
            "remainingMinutes": d.remaining_time,
            "cookedMinutes": d.cooked_time,
        }
    if isinstance(d, Dimmer):
        return {
            "_tag": "Dimmer",
            **base,
            "isOn": bool(state),
            "brightness": d.get_brightness(force_update=True),
        }
    return {"_tag": "Switch", **base, "isOn": bool(state)}


def device_call(device_id: str, action) -> dict:
    d = registry.get(device_id)
    try:
        with registry.lock:
            action(d)
        return serialize(d)
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(502, f"{d.name}: {err}") from err


class PowerBody(BaseModel):
    isOn: bool


class BrightnessBody(BaseModel):
    level: int = Field(ge=0, le=100)


class CookBody(BaseModel):
    mode: Literal["Off", "Warm", "Low", "High"]
    minutes: int = Field(default=240, ge=0, le=24 * 60)


class WifiBody(BaseModel):
    ssid: str = Field(min_length=1)
    password: str
    host: str = "10.22.22.1"


app = FastAPI(title="WeMo")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": os.environ.get("WEMO_VERSION", "dev")}


@app.get("/api/devices")
def list_devices() -> list[dict]:
    out = []
    for d in registry.all():
        try:
            out.append(serialize(d))
        except Exception:
            continue
    return out


@app.post("/api/scan")
def scan() -> list[dict]:
    registry.scan()
    return list_devices()


@app.post("/api/devices/{device_id}/power")
def power(device_id: str, body: PowerBody) -> dict:
    return device_call(device_id, lambda d: d.on() if body.isOn else d.off())


@app.post("/api/devices/{device_id}/toggle")
def toggle(device_id: str) -> dict:
    return device_call(device_id, lambda d: d.toggle())


@app.post("/api/devices/{device_id}/brightness")
def brightness(device_id: str, body: BrightnessBody) -> dict:
    def act(d: WeMoDevice) -> None:
        if not isinstance(d, Dimmer):
            raise HTTPException(400, f"{d.name} is not a dimmer")
        d.set_brightness(body.level)

    return device_call(device_id, act)


@app.post("/api/devices/{device_id}/cook")
def cook(device_id: str, body: CookBody) -> dict:
    mode = CrockPotMode[body.mode.upper()]
    minutes = body.minutes if mode in (CrockPotMode.LOW, CrockPotMode.HIGH) else 0

    def act(d: WeMoDevice) -> None:
        if not isinstance(d, CrockPot):
            raise HTTPException(400, f"{d.name} is not a Crock-Pot")
        d.update_settings(mode, minutes)

    return device_call(device_id, act)


@app.get("/api/devices/{device_id}/info")
def info(device_id: str) -> list[dict]:
    d = registry.get(device_id)
    return [
        {
            "name": name,
            "actions": [
                {
                    "name": aname,
                    "args": [str(a) for a in action.args],
                    "returns": [str(r) for r in action.returns],
                }
                for aname, action in svc.actions.items()
            ],
        }
        for name, svc in d.services.items()
    ]


@app.post("/api/setup-wifi")
def setup_wifi(body: WifiBody) -> dict:
    url = pywemo.setup_url_for_address(body.host)
    device = pywemo.device_from_description(url) if url else None
    if device is None:
        raise HTTPException(404, f"No WeMo device answered at {body.host}")
    try:
        status, message = device.setup(ssid=body.ssid, password=body.password)
    except Exception as err:
        raise HTTPException(502, str(err)) from err
    return {"status": status, "message": message}


if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
