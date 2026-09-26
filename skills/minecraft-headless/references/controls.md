# Input and captures

Read when first using the native input fallback or recovering a UI transition.

## Menu clicks


For menu buttons and text focus, the installed 1.26.50 client can acknowledge a `tap` without activating the control. Use a hover followed by separate press and release spanning rendered frames. A known failed tap does not warrant repeated tap/screenshot cycles.

```javascript
const instance = "task-id";
// x/y come from the latest screenshot, not remembered coordinates.
await tools.mcp__minecraft__mouse_move_to({instance, x, y});
await new Promise(r => setTimeout(r, 100));
await tools.mcp__minecraft__click({instance, x, y, action: "press"});
await new Promise(r => setTimeout(r, 100));
await tools.mcp__minecraft__click({instance, action: "release"});
await new Promise(r => setTimeout(r, 300));
const shot = await tools.mcp__minecraft__screenshot({instance, width: 854});
for (const c of shot.content ?? []) if (c.type === "image") image(c);
```

These short waits cover normal 30 FPS input/animation; increase them when measured FPS is lower. Release held buttons/keys in `finally` if a scripted sequence can fail. Once pointer focus is established, omit redundant hover steps. One screenshot per meaningful transition is usually enough; do not add `state` before every screenshot. Read `log` when diagnosing a failure, not as a routine prerequisite.

**Coordinates follow the most recent screenshot's dimensions.** The MCP changes its click scale each time `screenshot({width})` runs. Keep a consistent navigation width and derive new coordinates after changing it. A full-resolution proof capture also changes that scale. Native X input, by contrast, uses the underlying window/display coordinates.

### Joining a server

Select the existing requested saved entry in the Servers tab and Play. Use `add_server` once only when the entry is absent. It is navigation, not proof of a join. Inspect the current list before scrolling; scroll within its pane and verify the target name. Do not recreate duplicate entries on retries.

If `open_uri` was tried and stalls at the main menu or Servers tab, use the saved entry immediately. Do not cycle through URI spellings, repeat the same deep link, or restart a healthy client to fix navigation. Observe a join/loading screen before waiting for the server. On no progress, check the client log and proxy endpoint/version/authentication evidence; arbitrary longer sleeps do not establish success.

### Text and chat

Lunar commands use a **dot** (`.xray on`), not `/xray`. Verify settings and command responses before judging a visual effect.

- On the installed 1.26.50.4 build, skip the already-failed MCP `chat`/`type` path and use native input directly. Only test a different path when the client/fork changed or the requested task tests that input path. `ok: true` only means events were queued.
- Open chat with `t`, allow about 300 ms, then focus the input with separate press/release. Use native input on the affected build. Check the visible caret and full text; never blindly append another copy.
- When simulated text or Enter fails, use the bundled **[native_input.py](../scripts/native_input.py)** immediately. It finds the exact instance's client process and authenticated private Xvfb display, then focuses its Minecraft window. MCP's reported focus can differ from actual X keyboard focus. Keep using MCP screenshots for feedback.

```bash
python /home/danick/.codex/skills/minecraft-headless/scripts/native_input.py \
  --instance task-id --text '/xray on' --keys Home Delete period
```

Run that example in an empty, focused field. For Lunar chat it types the slash form and replaces its leading slash with a dot, working around the affected chat widget. The helper supports printable ASCII and X key names; it never submits unless explicitly given `--keys Return`. For ordinary fields, use `--text 'value'` without prefix conversion. If needed, `--click X Y` focuses the field using full window coordinates.

**Ctrl+A and selection deletion proved unreliable in the live benchmark.** To replace existing single-line text, pass `--clear-chars N` using its observed length: End plus N native BackSpaces, then the new text. Check that the field is empty once before trusting a combined clear/type sequence on a new widget. Do not repeatedly append text or infer success from highlighting alone. Keep the helper's 50 ms event delay initially; shorter delays need correctness checks, not just timing.

To submit affected chat, click the send arrow so it has the green focus outline, then press Enter; native `--keys Return` is available if MCP Enter fails. Verify the command response. After two attempts without new progress, diagnose the frame/log or use an authorized test fixture; do not accumulate commands or repeatedly reconnect. Test-only defaults can validate rendering, but cannot stand in for validating the command itself.
