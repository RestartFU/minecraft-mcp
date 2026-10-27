# Local installation and isolation

Read for launch failures, custom profiles, or missing tools. Ordinary capture work does not need a fresh installation audit.


- MCP: `/home/danick/.local/share/minecraft-mcp/src/index.ts`, run by `/home/danick/.local/bin/bun`.
- Client wrapper: `/home/danick/.local/bin/mcpelauncher-headless`. It owns the authenticated Xvfb display, TCP disabled, software rendering. `--hidden` alone does not make Linux EGLUT headless. Read the wrapper if diagnosing which fork executable it launches; do not assume it still uses Flatpak `/app/bin`.
- The Fedora wrapper uses `/home/danick/.local/libexec/mcpelauncher-client-agent`, a symlink to the installed versioned agent binary. `MCPELAUNCHER_AGENT_BINARY` can select another binary accessible inside the Flatpak sandbox. It explicitly enables X11 and sets `EGL_PLATFORM=x11`; inheriting a desktop Wayland setting prevents use of the private Xvfb display.
- User Flatpak: `io.mrarm.mcpelauncher`, origin `mcpelauncher-fork`; system Flathub is rollback. Do not switch to the standalone host client as a fallback: it previously crashed loading this game.
- Installed games/default profile: `/home/danick/.var/app/io.mrarm.mcpelauncher/data/mcpelauncher`, ABI `x86_64`. Socket directory: `/home/danick/.var/app/io.mrarm.mcpelauncher/data/s` (host `/tmp` is not Flatpak `/tmp`). MCP environment configures `MCPELAUNCHER_CLIENT`, `MCPELAUNCHER_DATA`, `MCPELAUNCHER_ABI`, and `MCPELAUNCHER_SOCKET_DIR`; preserve local support for these on updates.

If launch reports a missing prerequisite, check `command -v xvfb-run` and `command -v xauth`; the Fedora installation command is `sudo dnf install xorg-x11-server-Xvfb xorg-x11-xauth`. Do not download another runtime or open a desktop window to work around it.

## Launcher compatibility module

Install the official [mcpelauncher-updates release](https://github.com/minecraft-linux/mcpelauncher-updates/releases) under `mods/mcpelauncher-updates/<installed-version>/<ABI>/` in the launcher data directory, retaining the release's `patches/` directory and notices. The MCP passes that directory to the client automatically. A crash while loading game libraries can require this maintained compatibility module; see the [upstream startup issue](https://github.com/minecraft-linux/mcpelauncher-manifest/issues/2007).

The module's first run may open a launcher window requesting Google credential access for ownership verification before the agent socket exists. Get the user's approval for that credential grant before accepting it. Inspect the exact task's private Xvfb display when a socket timeout follows this prompt; game screenshot tools are unavailable until startup completes. Never print, log, or save the credential helper's output. Reuse the existing profile and credentials, and verify a fresh launch after the initial authorization.

If the module asks for credentials on every launch and then aborts with `std::out_of_range: map::at`, it rejected the profile's `pass.token` and `playapi_cache.dat`. This happens when the desktop launcher shares the profile and refreshes them. Give the MCP its own launcher data directory through `MCPELAUNCHER_DATA` instead of sharing the desktop launcher's.

## GPU rendering

`bin/mcpelauncher-headless-gpu` replaces Xvfb with gamescope's headless backend, so the client renders on a GPU through a private display (`sudo dnf install gamescope`). `MCPELAUNCHER_VK_DEVICE` lists GPUs by `lspci -nn` vendor:device ID in order of preference, separated by commas; the first one present is used, otherwise gamescope's default. `systemd-run` does not pass the MCP's environment to the client unit, so set `MCPELAUNCHER_VK_DEVICE` and `MCPELAUNCHER_AGENT_BINARY` in a small host launcher that executes the wrapper, and point `MCPELAUNCHER_CLIENT` at that launcher. Native input accepts clients under either `xvfb-run` or headless gamescope.

On an 854×480 main menu, GPU rendering reduced launch to menu from 8.0 to 5.1 seconds and game CPU at 20 FPS from 0.26 to 0.03 cores. Screenshot latency stayed at 50 ms.

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
