# Measurements, 2026-09-18

The initial test below compared Jev against already-batched code, not the slow parent visual loop. The follow-up measured the actual bottleneck: **23.081 s with parent screenshot decisions versus 3.496 s median for a local-first loop** on a title → Play → title route (one baseline, three successful loop trials). Three internal frames remained, but only the final frame needed to return to the parent. All successful hybrid trials used local checks; Jev was available as fallback but was not called. Jev-only completed one route in 4.393 s, then abstained on a repeat. These results support moving known transitions into a local loop, not forcing Jev into every step.

Read the [follow-up report](/home/danick/.local/share/minecraft-benchmarks/2026-09-18-jev/turn-loop/report.md) and [route format](route-plan.md) for the runnable workflow, failures and measurement limits. The older results below remain valid for their narrower comparison.

## Results

| Measurement | Result | Scope |
|---|---:|---|
| Jev recovery API latency | 207 ms median; 159–453 ms range | 36 sequential requests through one persistent HTTP client |
| Recovery decisions | 36/36 raw choices correct; 35/36 after confidence gate | 12 curated cases × 3 repeats; one correct native-input choice became fallback at confidence 0.89 |
| Local OCR menu transition | 1.853 s median; 1.844–1.876 s | Three successful live title → Play transitions; all final images visually checked |
| Matched local arm | 1.841 s | One additional live trial in the same client as the Jev arm |
| Matched Jev arm | 2.594 s, then fallback | Correct raw Play classification, confidence 0.67; did not meet automated verification threshold |
| Saved-image replay | 307 ms median OCR + API | Six calls on two saved frames; all six raw labels correct, zero cleared confidence gate |

The paired Jev attempt took 753 ms longer (41%) than its local arm and required parent review. It is not a successful end-to-end automated completion. The three additional local trials verify the small deterministic baseline; the Jev live sample remains **one**. No full-agent baseline was rerun, and no claim of agent-level speedup follows from these numbers.

Image replay used two title-button crops (Play, Settings) instead of the live run's three (also Realms), plus the same Play-screen crops. This is a deliberately smaller observation, not an identical repeated live trial. Confidence remained below 0.90 even when raw labels were right. Do not lower the threshold to make this small test pass.

## Method and failed calibration

Minecraft 1.26.50.4, hidden 854×480 window, 30 FPS, software rendering, dedicated already-onboarded `skill-bench-0917` profile. Other chats' clients remained untouched. All clients launched by this task were stopped.

A persistent MCP SDK connection performed capture, hover, press, release, wait and capture. A persistent Python worker used local Tesseract/Pillow and HTTPX. Both arms used the same observed crop regions, 100 ms hover, 100 ms press and 1.5 s settle. Local rules recognized Play+Settings or Servers+Create new world (including OCR's `worid`). Jev used the helper's fixed screen descriptions. Timings include captures, file writes, OCR, IPC, decision, input and settling; exclude startup, calibration, reset to title and human review. They are local menu measurements, not server-join or gameplay performance.

Retained failures:

1. Whole-frame OCR missed the title buttons, producing fallback. Cropping inspected buttons made them readable.
2. A 300 ms settling trial captured a blank transition and failed its next readiness check. It is excluded from successful timing claims.
3. With 1.5 s settling, the initial local classifier still failed because OCR read Worlds as `borids`. The final local classifier uses readable Servers/Create new world labels instead; the failed row is retained.
4. The live Jev arm reached Play, but its noisy OCR yielded insufficient confidence. Further automatic Jev live trials stopped at that boundary.

## Chat-derived cases

Locally inspected assistant observations from:

- Block picker, `01a0a151-c0f1-7ea1-9dff-73e8d892c636`: failed text focus/typing.
- Relog, `01a0af57-d48d-71b0-a45e-c148bad85eb9`: join deep link stalled; saved entry used.
- RegionMap, `01a0a553-858a-7113-ae3a-64868a992116`: old pack reused, raw action-bar text instead of the intended grid.

[Replay cases](replay-cases.json) contain three sanitized paraphrases and nine constructed controls/variants (including stale text, premature FPS readiness, unsaved evidence, unfamiliar dialogs and hostile server text). These are recovery-decision replays, **not live reproductions of the Lunar feature bugs**. No raw chats, addresses, tokens or private server data were sent to Jev. Repeats measure latency/consistency, not 36 independent scenarios or a held-out generalization benchmark.

## Artifacts

[Local evidence directory](/home/danick/.local/share/minecraft-benchmarks/2026-09-18-jev) contains:

- `replay.json`: every recovery answer, confidence, timing and usage.
- `image-replay.json`: every saved-image OCR/answer/timing.
- `live-final/results.json`: the paired local/JeV attempt and before/after PNGs.
- `local-validation/results.json`: three final local trials and PNGs.
- `live/` and `live-settled/`: retained calibration failures.

The private key is separate at `~/.config/minecraft-jev/credentials.env`, mode 600. Skill validation and six response-boundary unit tests pass.

## Rerun

Recovery decisions, no client needed:

```bash
python /home/danick/.codex/skills/minecraft-jev/scripts/replay.py \
  /tmp/jev-replay.json --repeats 3
```

Live experiment, dedicated onboarded profile only:

```bash
/home/danick/.local/bin/bun \
  /home/danick/.codex/skills/minecraft-jev/scripts/benchmark.ts \
  /home/danick/.var/app/io.mrarm.mcpelauncher/data/skill-bench-0917 \
  /tmp/jev-minecraft-bench 3 local,jev
```

The harness captures `calibration-main.png` and `calibration-play.png`, then waits up to three minutes for `calibration.json`. Inspect those frames and only then write crop coordinates to that file, e.g. the verified current-layout value:

```json
{"play_regions":[[110,48,742,74],[620,115,737,133]]}
```

The title-screen target and crops are fixed to the inspected benchmark layout. For a different build/layout, inspect and update those before permitting clicks. The helper never generates coordinates. Existing calibration files skip the pause, so use a fresh output directory when layout is not already verified. Pass `local` as the final argument for the deterministic-only baseline. A fallback aborts the live batch, preserves frames, records the failure and cleans up the owned client; do not treat a nonzero run as completed trials.

## Screenshot handoff follow-up, 2026-09-30

The [headless screenshot decision benchmark](../../minecraft-headless/references/benchmarks.md#screenshot-interpretation-and-subagent-handoff)
compares Luna, GPT-6.1-Sol, and this helper's whole-frame versus cropped OCR, and
records three verified local routes. Read it for the measured timings, retained
failures, and the separate-MCP-connection limitation on direct subagent access.
