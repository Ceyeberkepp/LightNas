#!/usr/bin/env python3
"""Reconcile the LightNAS control-plane port without terminating unrelated services.

Called after systemd has stopped the managed LightNAS control plane. Only an
orphaned Node.js process running this exact install's src/server.mjs is eligible
for a graceful SIGTERM. Never force-kill an unknown port owner.
"""
import argparse
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

PID_RE = re.compile(r"\bpid=(\d+)\b")
SERVICE_RE = re.compile(r"/([^/\n]+\.service)(?:/|$)")


class PortConflict(RuntimeError):
    pass


def listeners(port):
    try:
        result = subprocess.run(
            ["ss", "-H", "-ltnp", f"( sport = :{port} )"],
            text=True, capture_output=True, timeout=10, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PortConflict("Cannot inspect the management port using ss") from exc
    if result.returncode != 0:
        raise PortConflict(f"Cannot inspect TCP port {port}: {result.stderr.strip()}")
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    pids = set()
    for line in lines:
        pids.update(int(value) for value in PID_RE.findall(line))
    return lines, pids


def process_command(pid, proc_root=Path("/proc")):
    try:
        raw = (proc_root / str(pid) / "cmdline").read_bytes()
        return [part.decode("utf-8", "replace") for part in raw.split(b"\0") if part]
    except (OSError, ValueError):
        return []


def is_orphaned_lightnas(pid, server_path, proc_root=Path("/proc")):
    """Positive identification: exact Node entrypoint and no other service."""
    process = proc_root / str(pid)
    argv = process_command(pid, proc_root)
    if len(argv) != 2 or Path(argv[0]).name not in ("node", "nodejs"):
        return False
    try:
        entrypoint = Path(argv[1])
        if not entrypoint.is_absolute():
            entrypoint = Path(os.readlink(process / "cwd")) / entrypoint
        if entrypoint.resolve(strict=True) != Path(server_path).resolve(strict=True):
            return False
        cgroup = (process / "cgroup").read_text()
    except (OSError, ValueError):
        return False
    # A process owned by another systemd unit belongs to that unit, even if
    # it happens to use a LightNAS entrypoint. Do not interrupt that service.
    services = SERVICE_RE.findall(cgroup)
    return all(re.fullmatch(r"user@\d+\.service", service) for service in services)


def reconcile(port, server_path, *, wait_seconds=8, read_listeners=listeners,
              is_orphan=is_orphaned_lightnas, terminate=os.kill, sleep=time.sleep,
              monotonic=time.monotonic):
    lines, pids = read_listeners(port)
    if not lines:
        return "Management port is available."
    if not pids or any(not is_orphan(pid, server_path) for pid in pids):
        raise PortConflict(
            f"TCP port {port} is occupied by an unknown or separately managed process. "
            f"Do not terminate it automatically. Run: ss -ltnp '( sport = :{port} )'\n"
            + "\n".join(lines)
        )
    # Recheck ownership immediately before signalling to reduce PID reuse risk.
    for pid in sorted(pids):
        current_lines, current_pids = read_listeners(port)
        if pid not in current_pids:
            continue
        if not is_orphan(pid, server_path):
            raise PortConflict(f"TCP port {port} changed ownership; refusing to terminate PID {pid}")
        print(f"      Stopping duplicate unmanaged LightNAS instance (PID {pid})...", flush=True)
        try:
            terminate(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
        except OSError as exc:
            raise PortConflict(f"Cannot gracefully stop duplicate LightNAS PID {pid}: {exc}") from exc
    deadline = monotonic() + wait_seconds
    while monotonic() < deadline:
        current_lines, _ = read_listeners(port)
        if not current_lines:
            return "Duplicate LightNAS process stopped; management port is available."
        sleep(0.25)
    current_lines, _ = read_listeners(port)
    if current_lines:
        raise PortConflict(
            f"TCP port {port} is still occupied after graceful shutdown. "
            "No force-kill was attempted.\n" + "\n".join(current_lines)
        )
    return "Management port is available."


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=3080)
    parser.add_argument("--server", required=True)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535")
    if os.geteuid() != 0:
        parser.error("Run as root to inspect port ownership")
    try:
        print("      " + reconcile(args.port, args.server))
    except PortConflict as exc:
        print(f"ERROR: LightNAS cannot claim its management port:\n{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
