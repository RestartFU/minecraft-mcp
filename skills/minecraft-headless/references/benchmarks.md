# Measured workflow performance

Measured locally on 2026-09-17 with Minecraft 1.26.50.4, the installed headless fork, software rendering, and an isolated profile. These are local menu measurements, not server-join or whole-agent completion-time guarantees.

| Measurement | Baseline median | Revised median | Samples |
|---|---:|---:|---:|
| Launch call returns | 26.52 s (`wait_for_menu: true`) | 3.52 s (`false`) | 3 per mode |
| Screenshot verifies usable main menu | 26.64 s | 8.17 s | 3 per mode |
| Launch through verified Play screen | 28.38 s | 9.94 s | 3 per mode; all six succeeded |
| 854 px screenshot, 10 → 30 FPS | 113 ms | 48 ms | 12 per setting |
| 854 px screenshot, 30 → 60 FPS | 48 ms | 44 ms | 12 per setting |
| Clear and replace 14 ASCII characters | Selection-based clearing was unreliable | 3.112 s with explicit BackSpaces | 3 successful replacements |

Startup used identical 854×480, 30 FPS settings, with alternating mode order. The revised startup test allowed four seconds of additional rendering after the first nonzero-FPS observation, then captured the menu and exercised Play. Inspecting all six final images confirmed the Play screen. The 8.17-second result is a sampled upper bound on readiness, not the exact earliest ready instant. Routine work should inspect frames and overlap startup with useful work rather than adopt that fixed sleep.

An earlier rejected trial clicked as soon as `fps > 0`: all three fast trials still showed loading (40–65%). Do not report the 3.52-second launch return as a usable game. Shortening waits without checking action success can make the task slower.

Screenshot tests interleaved caps `[10,30,60,30,10,60]`, six samples per pass, on a static menu. State and pointer RPCs took about 3–4 ms. Downscaling 854 → 426 px reduced PNG size from about 357 KB to 123 KB, but sacrifices text readability and changes subsequent MCP click coordinates. Use smaller images for coarse checks, appropriate resolution for text/proof. Do not raise FPS indiscriminately on several software-rendered clients.

Native-input trials exposed two separate failures: X keyboard focus remained on PointerRoot while MCP reported focus; and selection deletion left old text behind. The helper focuses the exact Minecraft window on the instance's private display and supports `--clear-chars N`. Three consecutive `Native Bench01` → `02` → `03` → `04` field replacements succeeded with 50 ms per event. This verifies a local single-line world-name field, not every chat widget or command submission. Ctrl+A/selection-based and shorter-delay exploratory runs are excluded from successful timing claims.

## Chat evidence

The audit inspected 25 saved Codex chats containing native Minecraft MCP calls before this task began, with call IDs deduplicated and strings/comments excluded from source matching. It found 10,451 MCP-containing call blocks. Logged source contains 556 launch, 6,768 screenshot, 7,542 wait, 1,198 type, and 180 chat call sites. These are **source call-site counts**, not successful operations or dynamically expanded loop counts. Their literal waits sum to 7.74 hours across several days/tasks; that is not a measured amount of wasted time.

Completed single-tool launch blocks had a 26.53-second median (68 samples). Gaps from the preceding tool output to the next Minecraft-containing call had a 7.85-second median among gaps up to 120 seconds. Those gaps include reasoning, scheduling, and other work; they are not pure MCP latency. This supports batching known sequences, not removing required visual decisions.

Examples inspected:

- Relog work (`01a0af57-d48d-71b0-a45e-c148bad85eb9`, Sep 17): deep-link recovery, delayed text and failed chat submission; native input and test triggers eventually used. Preserve intentionally low FPS for that timing reproduction.
- RegionMap (`01a0a553-858a-7113-ae3a-64868a992116`, Sep 15–16): repeated input recovery; an explicit report that stale hidden chat text concatenated commands and caused a restart.
- Block picker (`01a0a151-c0f1-7ea1-9dff-73e8d892c636`, Sep 14–16): focus and search replacement failures, discarded recordings, repeated setup.
- AimAssist renderer (`01a0a5be-9da7-7873-83cb-7713701302da`, Sep 15–17): heavy restart/capture iteration mixed with actual renderer fixes and resource-pack/entity caching. Its entire duration cannot fairly be attributed to the MCP.

Raw metrics, sanitized audit metadata, original skill backup, and before/after startup frames live in [the local benchmark directory](/home/danick/.local/share/minecraft-benchmarks/2026-09-17/report.md). No private chat contents or authentication data were copied into this skill.

## Rerun

The startup harness uses one persistent MCP SDK connection, unique instance IDs, sequential trials, and cleanup of its own clients. Use its dedicated profile inside the Flatpak shared data directory with onboarding already completed. The harness refuses the default login profile so its measurements use stable benchmark state. It opens Play on the known 854×480 menu and does not join a server or create a world. A fresh profile instead shows onboarding: those images are failed readiness trials, not equivalent results.

```bash
/home/danick/.local/bin/bun \
  /home/danick/.codex/skills/minecraft-headless/scripts/benchmark.ts \
  /home/danick/.var/app/io.mrarm.mcpelauncher/data/skill-bench-0917 \
  /home/danick/.local/share/minecraft-benchmarks/rerun 3
```

Review each `*-before.png` and `*-after.png` alongside `launch.json`; the harness deliberately does not infer semantic success from pixels changing. Report sample sizes and failures.

To remeasure tool latency, use one task-owned instance and `Date.now()` around awaited native MCP calls inside one `functions.exec`; collect several samples of `state`, `mouse_move_to`, and `screenshot` at each FPS cap, alternating cap order. Save timings and image sizes, and forward only frames needed for visual decisions. Keep screenshot mutations and clicks sequential. Do not include model-round-trip time in an RPC-only result or infer end-to-end speedup from it.

## Follow-up: detect the visible menu

On 2026-09-26, a single 20 FPS startup probe sampled screenshots about every 550 ms.
The client socket appeared at 3.52 s. The last loading frame was at 7.43 s; the
first visible main menu frame was at 8.02 s. The former fixed menu wait returned
at 26.84 s in the MCP smoke test. The revised wait checks two visible menu frames
and returned at 8.51 s in a full MCP smoke test, then 8.45 s in a second local
benchmark at 854×480 and 20 FPS. The smoke test then completed the in-game Add
Server form successfully. These are individual runs, not a latency guarantee;
retain the 20 FPS default for routine work. Menu image decoding cost 5.5 ms per
frame in a 20-frame local sample.

## New server through joined world

On 2026-09-26, a task-owned offline Dragonfly fixture at `127.0.0.1:19357` accepted
Minecraft 1.26.50.4 and sent a `BENCH_READY` title after join. The benchmark launched
one hidden 854×480 client at a time at 20 FPS, added a uniquely named server through
`add_server(join: true)`, verified the exact saved name/host/port, confirmed the
external-server prompt, and stopped only its own client. A visible living world with
`BENCH_READY` was the completion check. All disposable entries were removed.

| Game CPU ceiling | Menu visible | Server saved + prompt confirmed | Living world confirmed | Game cgroup throttled CPU time |
|---|---:|---:|---:|---:|
| 150% | 9.13 s | 18.74 s | 38.08 s | 74.87M µs |
| 250% | 8.55 s | 15.29 s | 29.56 s | 17.64M µs |
| 400% | 8.43 s | 14.97 s | 29.86 s | 5.45M µs |

These are **one successful run per ceiling**, not stable medians. The game process's
own cgroup showed the requested `cpu.max` and a 4 GiB `memory.max` in each capped
run. `throttled_usec` counts runnable CPU time across threads, not seconds added to
the wall clock. The 250% ceiling was fastest in this small comparison and uses less
peak CPU capacity than 400%, so it is the default. A remote server can add auth,
network, pack, and world-load delays absent from this local fixture.

For form input, two uncapped 20 ms trials saved the exact server and reached a living
world (26.06 and 28.51 s); their prompt-confirmation times were 13.08 and 13.14 s.
A 50 ms trial confirmed the prompt at 15.66 s, but its world frame had a death screen,
so it is excluded from successful-join comparisons. A single 10 ms trial with visual
screen checks confirmed the prompt at 13.41 s and the world at 26.48 s. The server
form therefore uses 20 ms input; other native input keeps its 50 ms default. The form
waits for rendered Servers-tab and Add Server frames rather than fixed sleeps.

Rerun only against a task-owned server that supplies a recognizable in-world marker:

```bash
bun scripts/join_benchmark.ts --target 127.0.0.1:19357 \
  --mode combined --world-text BENCH_READY \
  --output /tmp/minecraft-join-rerun --cpu-quota-percent 250
```

The harness stores stage times, frames, and the actual game cgroup's limits under
`/tmp`, then stops its client and removes its exact temporary server entry. It
refuses a target already in the saved list. The `saved` secondary route was not
validated in the final runs; `combined` is the measured path.

## Follow-up: eliminate repeated work

The MCP now defaults to 20 FPS and early-return launch. The earlier SDK smoke test
with 30 FPS returned in 3.52 s and reached a visually verified Play screen in 9.84 s.
Existing MCP processes keep old defaults until normal restart.

A cross-session inventory check measured 38 ms median over five calls. One live sample found five clients consuming roughly 4.4 CPU cores together. The helper is a cheap global client-count snapshot, not a lock or authority to stop other clients. See [follow-up evidence](/home/danick/.local/share/minecraft-benchmarks/2026-09-17/followup/report.md).
