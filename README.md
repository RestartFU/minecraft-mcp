# Minecraft MCP

An MCP server and agent skills for controlling a real Minecraft Bedrock client through the
[mcpelauncher agent socket](https://github.com/bedrock-mc/mcpelauncher-manifest). This checkout is
the source for the installed `minecraft` MCP and `minecraft-headless` skill on the Fedora host.

## Requirements

- Linux with a user systemd manager, `xvfb-run`, `xauth`, Python 3, and the agent-enabled
  mcpelauncher client. The bundled `bin/mcpelauncher-headless-fedora` documents this host's
  Flatpak launcher command; set `MCPELAUNCHER_CLIENT` to the installed wrapper.
- Bun, a locally installed Bedrock version, and a signed-in launcher data directory.
- On this host, `MCPELAUNCHER_ABI=x86_64`,
  `MCPELAUNCHER_DATA=/home/danick/.var/app/io.mrarm.mcpelauncher/data/mcpelauncher`, and
  `MCPELAUNCHER_SOCKET_DIR=/home/danick/.var/app/io.mrarm.mcpelauncher/data/s`.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run src/index.ts
```

## Session controls

`preflight` and `launch` count actual clients across MCP connections, check host load, and
require available RAM equal to the requested session memory limit plus 2 GiB. At most four
clients run at once. Each Linux client starts in its own systemd user unit with a default
150% CPU quota (1.5 cores) and 4096 MiB memory limit. Routine sessions render at 20 FPS.
`launch` accepts bounded `cpu_quota_percent`, `memory_limit_mib`, and `fps_cap` overrides.

The cleanup timer checks every ten minutes and stops only agent-owned clients whose MCP
lease has been idle for two hours. Install it with:

```sh
mkdir -p ~/.config/systemd/user
cp deploy/minecraft-mcp-cleanup.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now minecraft-mcp-cleanup.timer
```

## Tools

`preflight` · `launch` · `stop` · `list` · `state` · `screenshot` · `key` · `hold_key` · `type` ·
`chat` · `look` · `click` · `mouse_move_to` · `scroll` · `add_server` · `open_uri` · `set_fps` ·
`wait` · `log`

Most tools take an optional `instance`. Use a unique instance ID per task. `list` covers the
current MCP process; `skills/minecraft-headless/scripts/client_inventory.py` counts every
live agent client on the host.

`type` and `chat` use the bundled native XTest input helper on that instance's private Xvfb
display. The helper accepts printable ASCII. Screenshots and mouse input use the launcher
agent socket. See [the skill](skills/minecraft-headless/SKILL.md) for working navigation
patterns and [the Jev skill](skills/minecraft-jev/SKILL.md) for reviewed repeated routes.

## Verification

`scripts/benchmark.ts` runs a single bounded client, records launch, screenshot, and stop
timings, and always stops the client on exit. It requires the same launcher environment
variables as the MCP. Use its output to compare changes to launch behavior; do not run
multiple benchmark clients when host resources are constrained.
