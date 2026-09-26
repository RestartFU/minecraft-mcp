#!/usr/bin/env python3
"""Quit only agent-owned Minecraft clients idle for two hours."""
import argparse
import json
import os
import signal
import socket
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/minecraft-headless/scripts"))
from client_inventory import clients  # noqa: E402

LEASE_SUFFIX = ".lease.json"


def eligible(lease_path, clients_by_socket, now, idle_seconds):
    try:
        lease = json.loads(lease_path.read_text())
        socket_path = str(lease_path)[:-len(LEASE_SUFFIX)]
        client = clients_by_socket.get(socket_path)
        if not client or now - float(lease["lastUsed"]) / 1000 < idle_seconds:
            return None
        return client
    except (OSError, ValueError, KeyError, TypeError):
        return None


def same_client(client):
    try:
        argv = Path(f'/proc/{client["pid"]}/cmdline').read_bytes().split(b'\0')
        return os.fsencode(client["socket"]) in argv and \
            Path(os.fsdecode(argv[0])).name.startswith("mcpelauncher-client")
    except (OSError, ValueError, IndexError):
        return False


def wait_exit(client, seconds):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if not same_client(client):
            return True
        time.sleep(0.25)
    return not same_client(client)


def quit_client(client):
    if not same_client(client):
        return
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(2)
            conn.connect(client["socket"])
            conn.sendall(b'{"id":1,"cmd":"quit"}\n')
    except OSError:
        pass
    if wait_exit(client, 3):
        return
    for sig in (signal.SIGTERM, signal.SIGKILL):
        if not same_client(client):
            return
        os.kill(client["pid"], sig)
        if wait_exit(client, 2):
            return


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket-dir", type=Path, default=Path(os.environ.get(
        "MCPELAUNCHER_SOCKET_DIR", "/home/danick/.var/app/io.mrarm.mcpelauncher/data/s")))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    by_socket = {c["socket"]: c for c in clients()}
    now = time.time()
    stale = []
    for lease_path in args.socket_dir.glob("mcpelauncher-agent-*.sock" + LEASE_SUFFIX):
        client = eligible(lease_path, by_socket, now, 2 * 60 * 60)
        if not client:
            continue
        stale.append({"instance": client["instance"], "pid": client["pid"]})
        if not args.dry_run:
            quit_client(client)
            if not same_client(client):
                lease_path.unlink(missing_ok=True)
    print(json.dumps({"stale": stale, "dry_run": args.dry_run}))


if __name__ == "__main__":
    main()
