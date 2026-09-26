# Local installation and isolation

Read for launch failures, custom profiles, or missing tools. Ordinary capture work does not need a fresh installation audit.


- MCP: `/home/danick/.local/share/minecraft-mcp/src/index.ts`, run by `/home/danick/.local/bin/bun`.
- Client wrapper: `/home/danick/.local/bin/mcpelauncher-headless`. It owns the authenticated Xvfb display, TCP disabled, software rendering. `--hidden` alone does not make Linux EGLUT headless. Read the wrapper if diagnosing which fork executable it launches; do not assume it still uses Flatpak `/app/bin`.
- User Flatpak: `io.mrarm.mcpelauncher`, origin `mcpelauncher-fork`; system Flathub is rollback. Do not switch to the standalone host client as a fallback: it previously crashed loading this game.
- Installed games/default profile: `/home/danick/.var/app/io.mrarm.mcpelauncher/data/mcpelauncher`, ABI `x86_64`. Socket directory: `/home/danick/.var/app/io.mrarm.mcpelauncher/data/s` (host `/tmp` is not Flatpak `/tmp`). MCP environment configures `MCPELAUNCHER_CLIENT`, `MCPELAUNCHER_DATA`, `MCPELAUNCHER_ABI`, and `MCPELAUNCHER_SOCKET_DIR`; preserve local support for these on updates.

If launch reports a missing prerequisite, check `command -v xvfb-run` and `command -v xauth`; the Fedora installation command is `sudo dnf install xorg-x11-server-Xvfb xorg-x11-xauth`. Do not download another runtime or open a desktop window to work around it.

Use a unique instance id for every new client. Fresh profiles have onboarding and no Xbox login; do not create one per ordinary capture or copy authentication data casually. A separate MCP connection's empty `list` does not prove no other clients exist. Inspect matching client processes before a new launch, without dumping their environment or secrets.

If native tools are unavailable, discover them once, then use the installed MCP SDK with one persistent stdio connection across launch, input, capture and cleanup. A new connection has an empty instance map and cannot control instances launched by another connection. The bundled benchmark shows the installed SDK imports and environment. Keep image data out of text output: forward image content with `image(c)` or decode it directly to an artifact file.


## Check global client capacity before a new launch

```bash
python /home/danick/.codex/skills/minecraft-headless/scripts/client_inventory.py \
  --require-capacity 4
```

Exit 2 means the machine already has four or more clients; the JSON names the actual clients without reading credentials. This is a snapshot, not a locking mechanism. Do not turn it into a polling loop. Reuse a task-owned client if possible. Do not infer that an unfamiliar instance is abandoned or stop it. An authenticated remote-server test needs an appropriate authenticated profile; a fresh logged-out profile is not a substitute.

Call MCP `preflight` before launch, passing requested `cpu_quota_percent` and
`memory_limit_mib` when overriding the defaults. `launch` repeats the check, requiring
the memory limit plus 2 GiB of host available RAM and spare CPU capacity at least the
larger of 20% of the host or the requested quota. Linux caps the wrapper unit and
verifies the actual Flatpak game scope has the default 250% CPU quota and 4096 MiB
memory maximum before returning. `minecraft-mcp-cleanup.timer` stops agent clients
idle for two hours.

The local MCP source defaults to 20 FPS and early-return launch. Already-running MCP
processes retain their old defaults until their normal restart; pass explicit values there.
Do not restart an MCP process with live clients just to pick up defaults.
The installed versioned launcher supports the socket `render` command used by
`set_render_mode`. Its previous binary is backed up as
`/home/danick/.local/libexec/mcpelauncher-client-agent-26.50.pre-render`.
