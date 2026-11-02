# Lunar live validation

Read when validating Lunar through the off-screen client.


For Lunar development and verification, use the existing remote test servers, including `remoteBDS`; a local server is not a prerequisite. The user explicitly prefers using these configured servers when useful. Read `cmd/lunar/main.go` in the Lunar repository for the current upstream constants and launcher flags before connecting. As of September 2026, `remoteBDS` is `zenomc.org:19197`; related fixtures include `remoteBDSUnhashed` (`19195`), `remoteDF` (`19199`), `remotePMMP` (`19198`), `remoteNukkit` (`19196`), `remotePM1E` (`19194`), `remoteNukkitMOT` (`19200`), and `remoteGeyser` (`19201`) on the same host. Prefer the repository values if these change.

Run the worktree's Lunar proxy against the selected upstream and connect the off-screen Minecraft MCP client to that proxy for actual fix validation. Use the existing authenticated account/cache flow when the server requires Microsoft authentication; an offline probe rejected for authentication still demonstrates that the endpoint is reachable. Do not print tokens or bypass authentication. A failed local Dragonfly join or an obsolete `bds.lunarproxy.net` hostname does not establish that the configured remote servers are unavailable. Keep changes to shared test worlds bounded to the verification and clean up task-created fixtures when practical.

## Joining a Lunar proxy (Minecraft 26.60+)

Read this before the first join; it replaces trial and error. Host-specific values (public name, forwarded port range, which machine runs what) are in the user's private instructions.

**How a 26.60 client joins `host:port`.** RakNet is switched off for vanilla clients. The client first asks `GET /v1/join` over **TCP** on that port (https, then http), then opens a **WebRTC** connection (ICE over **UDP**, then DTLS/SCTP). Lunar's development proxy (`go run ./cmd/lunar`) therefore listens on **TCP** `-port` only; there is no RakNet UDP listener to relay. A UDP-only relay or port forward, which worked before 26.60, no longer carries a join.

**Pick the route from where the client runs:**

- **Client on the same machine as Lunar** (the MCP's local fallback, or a Lunar started on the MCP host): join `127.0.0.1:<port>`. Nothing else is needed.
- **Client on another network** (the usual remote MCP host): join `<public name>:<port>` where the router forwards that port in **both TCP and UDP** to the Lunar machine, and start Lunar with `-public-host <public name>`. That flag makes WebRTC media use UDP on the same port number and offer the public IPv4 address. Without it the client completes signaling, then fails ICE: Lunar only offers private addresses. Never join the LAN address Lunar prints, a WireGuard peer address, or a UDP relay from another network.
- Before launching the game for a remote join, check signaling from the client's machine: `curl -s -m5 http://<public name>:<port>/v1/join` must return JSON naming "Lunar Proxy". If it times out, the port is not forwarded or Lunar is not listening; fix that first.

**Client steps (1.26.60.4, 854×480):**

1. Prefer `launch` with `server_to_join: { name, address }`, or `add_server` with `join: true` on a running client. Both wait for Microsoft sign-in (the menu renders first; "Signing in with your Microsoft account…" at the bottom left means queued URIs have not run yet, and this has taken over two minutes on a slow host). They then confirm "Unknown External Server" and the first-join **"Trust this server?"** prompt; the result reports `trust_confirmed`. A failed `server_to_join` leaves the client running; screenshot it instead of relaunching.
2. If the profile does not have Lunar's current pack cached, Lunar then asks **"Download Resource Packs?"**. Click "Download Everything & Join" at (425, 265). Otherwise the client goes straight into the world. Take one screenshot about 10 s after the join returns and act on what it shows.
3. If `server_to_join` fails, it says why and leaves the client running. Screenshot it, then finish with `add_server` and `join: true` on the same instance; do not relaunch.
4. Manual fallback: from the main menu after sign-in, `open_uri` `minecraft://connect?serverUrl=<host>&serverPort=<port>`, click Continue at (425, 265), then **Trust and Join at (427, 282)**. "Don't Trust" is the green, default-focused button below it, so never press Return on that prompt. After a failed join, use "Back to menu" before sending the URI again; a connect URI sent from the Play screen is ignored.
5. Do not hunt for a saved entry in the Servers tab. A shared profile lists featured servers first and can hold hundreds of saved entries below them.

**Read the failure:**

| Symptom | Meaning | Fix |
| --- | --- | --- |
| "Terracotta" (InitialConnection) within seconds of Continue | `/v1/join` unreachable | Port not forwarded in TCP, wrong port, or Lunar not running |
| "Connection timed out" ("Kelp") after about 60 s, with nothing about the player in the Lunar log | WebRTC could not connect | Start Lunar with `-public-host`; check the UDP forward for the same port |
| "Connection timed out" with `failed to connect to upstream server` in the Lunar log | Lunar reached, upstream not | Fix the `-upstream` target (see below) |
| Stuck on the menu after `open_uri` | Sign-in not finished, or the URI was sent from the Play screen | Wait for sign-in; go back to the main menu |

**Upstream reachability.** Check the `-upstream` target from the Lunar machine before blaming the join: `curl -s -m5 http://<host>:<port>/v1/join` for NetherNet servers, or a RakNet ping. A host name that resolves to the Lunar machine's own public address only works if the router supports hairpin NAT. The user's private instructions say whether it does and where the fixtures run. A public server that answers is enough for a join check.

Before validating a settings-driven module, inspect its defaults instead of assuming the main toggle enables its subfeatures. In particular, `settings.DefaultSettings().Xray` normally has `HideTerrain: true` but `Ores: false`; `.xray on` alone does not turn ore highlighting on. Enable Ores through the Xray form or an explicitly test-only configuration, and verify the resulting view. If a temporary source default is necessary for an interactive test endpoint, build and start the process, immediately restore the source file, keep the change out of Git, and tell the user the running binary has test-only defaults.

**Shared auth cache.** Start Lunar with `-auth-store shared` and **no** `LUNAR_DEV_PASSPHRASE` first: the cached unlock token (`unlock.json` beside the cache, valid for days) unlocks it silently. An explicit `LUNAR_DEV_PASSPHRASE` overrides the token, and a stale one aborts startup with "does not decrypt", so set it only when the token has expired. The user's private instructions name the current passphrase source. Pass it only through the subprocess environment; never display it, put it in this skill, or include it in logs or command-line arguments. Never run with `-auth-unlock-ttl 0` or `-lock`: both delete the token, and every other task then needs the passphrase.

### BDS version checks and updates

Before interpreting a failed join as a Lunar bug, compare the installed Minecraft client version, the proxy's supported protocol, and the running BDS version. Read BDS startup logs or query its advertised version; a Compose pin alone does not prove the server was upgraded. Client and server build suffixes can differ: the verified 26.50 pairing was client `1.26.50.4` with BDS `1.26.50.5`.

When updating the BDS test fixtures within the user's requested scope:

- Read `deploy/bds/docker/compose.yaml` and `.github/workflows/deploy-server.yml` in the current Lunar checkout. Both `bds` and `bds-unhashed` share the Compose version pin through a YAML anchor, with `LUNAR_BDS_VERSION` as an override. Keep the deployment workflow deriving its version from `docker compose ... config --format json` (`.services.bds.environment.VERSION`). Do not replace an explicitly requested release with whatever the download API calls latest.
- Confirm the exact Linux BDS build exists on Minecraft's official download host. For 26.50, the archive is `https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.26.50.5.zip`. A successful archive integrity check is stronger evidence than the filename alone. On this machine, a stalled download succeeded with curl user-agent `itzg/minecraft-bedrock-server` and a cache-busting query; use a bounded retry only if needed.
- Resolve Compose configuration and check both service versions and the existing port mappings (`19197` and `19195`). Validate workflow syntax if changed. For an authorized deployment, identify the Docker host serving these endpoints first, back up the existing worlds outside the repository, and recreate only `bds` and `bds-unhashed` with `docker compose -f deploy/bds/docker/compose.yaml up -d --no-deps bds bds-unhashed`. Preserve the mounted data; do not remove volumes or reset worlds for a version update. Verify both containers' health and startup version, then join through the worktree proxy with the Minecraft MCP.
- If the user requests a BDS-only push directly to main, prepare it in a clean worktree based on fresh `origin/main`. Stage only the BDS configuration and any deployment change necessary to honor its pin, inspect the complete commit diff, and push `HEAD:main` without force. Verify the remote commit. Keep gameplay fixes, reproduction artifacts, and local skill edits out of that push. This procedure does not authorize future pushes or deployments beyond the user's request.
