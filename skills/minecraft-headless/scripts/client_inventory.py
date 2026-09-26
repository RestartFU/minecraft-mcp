#!/usr/bin/env python3
"""List real Minecraft clients across MCP connections, without reading credentials."""
import argparse
import json
import os
from pathlib import Path


def clients(proc_root=Path('/proc')):
    result = []
    for proc in proc_root.iterdir():
        if not proc.name.isdigit():
            continue
        try:
            argv = proc.joinpath('cmdline').read_bytes().split(b'\0')
            if not Path(os.fsdecode(argv[0])).name.startswith('mcpelauncher-client'):
                continue
            def arg(flag):
                try:
                    return os.fsdecode(argv[argv.index(flag) + 1])
                except (ValueError, IndexError):
                    return None
            socket = arg(b'--agent-socket')
            # Only report controllable agent clients, not launcher/error processes.
            if not socket:
                continue
            result.append({'pid': int(proc.name),
                           'socket': socket,
                           'instance': Path(socket).name.removeprefix('mcpelauncher-agent-').removesuffix('.sock'),
                           'profile': arg(b'-dd'), 'version': Path(arg(b'-dg') or '').name,
                           'fps_cap': arg(b'--fps-cap')})
        except (OSError, ValueError):
            continue
    return sorted(result, key=lambda r: r['pid'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-capacity', type=int, metavar='MAX_CLIENTS',
                        help='Exit 2 when MAX_CLIENTS or more clients are already running')
    args = parser.parse_args()
    if args.require_capacity is not None and args.require_capacity < 1:
        parser.error('--require-capacity must be at least 1')
    rows = clients()
    print(json.dumps({'clients': rows, 'total_clients': len(rows)}))
    if args.require_capacity is not None and len(rows) >= args.require_capacity:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
