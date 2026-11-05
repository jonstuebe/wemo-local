"""Local-only control of Belkin WeMo devices via pywemo (no cloud needed)."""

from __future__ import annotations

import argparse
import getpass
import os
import sys

import pywemo
from pywemo import CrockPot, CrockPotMode, Dimmer, WeMoDevice


def find_device(target: str | None) -> WeMoDevice:
    """Resolve a device by IP/hostname, or by name via discovery."""
    if target and (target[0].isdigit() or "." in target):
        url = pywemo.setup_url_for_address(target)
        if not url:
            sys.exit(f"No WeMo device answered at {target}")
        device = pywemo.device_from_description(url)
        if device is None:
            sys.exit(f"Could not load WeMo device at {target}")
        return device

    devices = pywemo.discover_devices()
    if not devices:
        sys.exit("No WeMo devices found on the network.")
    if target is None:
        if len(devices) > 1:
            names = ", ".join(d.name for d in devices)
            sys.exit(f"Multiple devices found ({names}); pass a name or IP.")
        return devices[0]
    for d in devices:
        if d.name.lower() == target.lower():
            return d
    sys.exit(f"No device named {target!r}. Run `wemo list` to see devices.")


def state_str(device: WeMoDevice) -> str:
    state = device.get_state(force_update=True)
    text = "on" if state else "off"
    if isinstance(device, Dimmer) and state:
        text += f" ({device.get_brightness(force_update=True)}%)"
    if isinstance(device, CrockPot):
        text = device.mode_string
        if state:
            text += f", {fmt_minutes(device.remaining_time)} left"
        text += f", cooked {fmt_minutes(device.cooked_time)}"
    return text


def fmt_minutes(minutes: int) -> str:
    return f"{minutes // 60}h{minutes % 60:02d}m"


def parse_duration(value: str) -> int:
    """Parse '90', '90m', '4h', or '4h30m' into minutes."""
    v = value.lower().strip()
    try:
        if "h" in v:
            hours, _, rest = v.partition("h")
            return int(hours) * 60 + (int(rest.rstrip("m")) if rest.rstrip("m") else 0)
        return int(v.rstrip("m"))
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid duration {value!r} (try 4h, 90m, 4h30m)")


def cmd_cook(args: argparse.Namespace) -> None:
    d = find_device(args.device)
    if not isinstance(d, CrockPot):
        sys.exit(f"{d.name} is not a Crock-Pot.")
    mode = CrockPotMode[args.mode.upper()]
    minutes = 0 if mode in (CrockPotMode.OFF, CrockPotMode.WARM) else args.time
    d.update_settings(mode, minutes)
    print(f"{d.name}: {state_str(d)}")


def cmd_list(args: argparse.Namespace) -> None:
    devices = pywemo.discover_devices()
    if not devices:
        print("No WeMo devices found. Make sure you're on the same network/subnet.")
        return
    for d in devices:
        print(
            f"{d.name:<24} {d.model_name:<16} {d.host}:{d.port:<6} "
            f"{state_str(d):<10} serial={d.serial_number} fw={d.firmware_version}"
        )


def cmd_status(args: argparse.Namespace) -> None:
    d = find_device(args.device)
    print(f"{d.name}: {state_str(d)}")


def cmd_on(args: argparse.Namespace) -> None:
    d = find_device(args.device)
    d.on()
    print(f"{d.name}: on")


def cmd_off(args: argparse.Namespace) -> None:
    d = find_device(args.device)
    d.off()
    print(f"{d.name}: off")


def cmd_toggle(args: argparse.Namespace) -> None:
    d = find_device(args.device)
    d.toggle()
    print(f"{d.name}: {state_str(d)}")


def cmd_brightness(args: argparse.Namespace) -> None:
    d = find_device(args.device)
    if not isinstance(d, Dimmer):
        sys.exit(f"{d.name} is not a dimmer.")
    d.set_brightness(args.level)
    print(f"{d.name}: {state_str(d)}")


def cmd_info(args: argparse.Namespace) -> None:
    d = find_device(args.device)
    d.explain()


def cmd_setup_wifi(args: argparse.Namespace) -> None:
    """Join a (factory-reset) device to your Wi-Fi.

    First connect this computer to the device's own "Wemo.XXX" Wi-Fi network,
    then run this. The device is usually at 10.22.22.1.
    """
    d = find_device(args.device)
    password = args.password or getpass.getpass(f"Password for {args.ssid!r}: ")
    status, message = d.setup(ssid=args.ssid, password=password)
    print(f"{status}: {message}")
    print("Reconnect this computer to your normal Wi-Fi, then run `wemo list`.")


def cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn

    print(f"WeMo UI at http://{'localhost' if args.host in ('127.0.0.1', '0.0.0.0') else args.host}:{args.port}")
    uvicorn.run("wemo.server:app", host=args.host, port=args.port)


def main() -> None:
    parser = argparse.ArgumentParser(prog="wemo", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="discover devices on the LAN").set_defaults(func=cmd_list)

    for name, func, help_ in [
        ("status", cmd_status, "show on/off state"),
        ("on", cmd_on, "turn on"),
        ("off", cmd_off, "turn off"),
        ("toggle", cmd_toggle, "toggle state"),
        ("info", cmd_info, "dump services/actions the device supports"),
    ]:
        p = sub.add_parser(name, help=help_)
        p.add_argument("device", nargs="?", help="device name or IP (optional if only one)")
        p.set_defaults(func=func)

    p = sub.add_parser("brightness", help="set dimmer brightness (0-100)")
    p.add_argument("device", help="device name or IP")
    p.add_argument("level", type=int, choices=range(0, 101), metavar="0-100")
    p.set_defaults(func=cmd_brightness)

    p = sub.add_parser("cook", help="Crock-Pot: set mode and cook time")
    p.add_argument("mode", choices=["off", "warm", "low", "high"])
    p.add_argument("time", nargs="?", type=parse_duration, default=240,
                   help="cook time for low/high, e.g. 4h, 90m, 6h30m (default 4h)")
    p.add_argument("--device", help="device name or IP (optional if only one)")
    p.set_defaults(func=cmd_cook)

    p = sub.add_parser("setup-wifi", help="join a reset device to your Wi-Fi")
    p.add_argument("ssid", help="your Wi-Fi network name")
    p.add_argument("--password", help="Wi-Fi password (prompted if omitted)")
    p.add_argument("--device", default="10.22.22.1", help="device IP (default: 10.22.22.1)")
    p.set_defaults(func=cmd_setup_wifi)

    p = sub.add_parser("serve", help="run the web UI and HTTP API")
    p.add_argument("--host", default=os.environ.get("WEMO_BIND", "127.0.0.1"),
                   help="bind address (use 0.0.0.0 to reach it from your phone)")
    p.add_argument("--port", type=int, default=int(os.environ.get("WEMO_PORT", "8765")))
    p.set_defaults(func=cmd_serve)

    args = parser.parse_args()
    args.func(args)
