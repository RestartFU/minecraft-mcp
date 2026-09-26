---
name: minecraft-headless
description: Control Minecraft Bedrock, join servers, and capture in-game screenshots using the minecraft MCP and installed headless launcher on this Fedora machine. Use for Minecraft client automation, not website screenshots or unrelated server development.
---

# Minecraft without repeated setup

Use the installed Minecraft MCP off-screen. For known, repeated menu navigation, default to the local-first loop with Jev fallback described below; the user does not need to request Jev separately. The task is to obtain the requested game result, not to explore the launcher. Keep evidence outside repositories. Visible play requires an explicit user request.

## Execute the shortest verified path

1. Define the completion check from the request: for example, join the named server, verify the feature, capture one readable frame. Stop the capture/interaction work when that check passes; do not add another server, input experiment, resolution, restart, or recording unless it answers an unresolved requirement.
2. **Resume a task-owned client and the last confirmed screen.** Do not repeat tool discovery, `list`, version checks, source reads, or setup already established in this task. Keep its instance, profile, screenshot dimensions, target, working input method, and failed paths in working context (`store`/`load` when available). Recheck only after a relevant change/error. Another task's client is not yours to control.
3. Before a **new** launch, call the MCP `preflight` tool. It checks host CPU, available RAM, and clients across MCP connections; `launch` repeats the check. If it refuses, do independent work and retry only after load has changed. `list` sees only its own MCP connection; [client_inventory.py](scripts/client_inventory.py) diagnoses global clients. Reuse your own task-owned instance when possible; otherwise launch with a unique instance id. Never take control of another task's client.
4. Launch with a unique id, `hidden: true`, **20 FPS**, **`wait_for_menu: false`**, normally **854×480**. To join a server on a new client, include `server_to_join: { name, address }` in this launch; it saves a new entry or reuses an existing one during startup and confirms the connection prompt before returning. Raise FPS only for a task that needs it. Use required device dimensions for layout tests. Overlap launch with genuinely needed build/setup work. Return to the first useful screenshot; do not fetch loading frames while independent work remains. If the next action needs the menu immediately, `wait_for_menu: true` checks rendered menu frames and returns when they appear. `fps > 0` alone is not menu readiness.
5. **Run known navigation locally; return only the final or failed frame.** Use the hybrid route workflow below for repeated menu transitions with verified controls and text checks. Keep intermediate observations inside that loop instead of making a parent-model turn after every screenshot. For actions outside the runner's supported click/navigation-key set, batch their established native tools in one `functions.exec`—for example, focus the known chat field → clear/type with native input → submit → observe the response. Use local `setTimeout` for short delays inside a batch; do not make separate wait-only tool turns. Await mutations sequentially and never race input and screenshots on one client.
6. Capture only when it decides the next action, confirms completion, or supplies requested evidence. After a model turn or other work has already allowed an action to settle, inspect immediately instead of prepending another sleep. Keep navigation width consistent; clicks use the **last screenshot's** pixels. Return image content through `image(c)`, never base64 text. Avoid routine `state`/`log` calls, duplicate full-size captures, and repeated image analysis when the screen has not meaningfully changed. **When evidence may be attached to GitHub, read [Proof attachments](references/proof-attachments.md) before the proof capture and persist that first valid frame before stopping the client. An inline MCP image is not a saved artifact.**
7. Stop task-created clients at task completion unless the user asked to keep them. Ordinary next steps within the same task reuse the client. Only restart for a crash or an identified cache/lifecycle requirement; a missed click or text focus is not such a requirement.

The local cleanup timer stops MCP-owned clients after two hours without MCP activity. It
preserves game data; use the normal `stop` tool promptly instead of relying on the timer.

Keep **20 FPS through startup, menus, and joining**. If a client must remain open for
passive waiting after the screen is settled, call `set_fps` with `cap: 5`; restore
`cap: 20` before active navigation, gameplay, or proof capture. The [local renderer
probe](references/benchmarks.md#renderer-and-idle-fps-probe) found that 5 FPS cut
settled menu CPU use, while starting at 5 FPS delayed the menu and consumed more
total CPU. `graphics_api:7` did not enable Noop on this Android client.

## Default loop for known menu navigation

Read [minecraft-jev](../minecraft-jev/SKILL.md) once when a task involves repeated known menu transitions, then use its [reviewed route format](../minecraft-jev/references/route-plan.md). Reuse a verified route when the current layout matches; otherwise inspect the unfamiliar screen before defining its controls and completion checks. A single straightforward action can remain a direct batched MCP call.

Run the installed helper with **`hybrid`** on the existing task-owned instance and its exact launch PID:

```bash
/home/danick/.local/bin/bun \
  /home/danick/.codex/skills/minecraft-jev/scripts/run-plan.ts \
  OWNED_INSTANCE PID /absolute/route.json /absolute/evidence-dir hybrid
```

The hybrid loop checks labels with local OCR first and asks Jev only when those checks cannot decide. Use the existing private credential configuration; never embed the key in a plan or command. Keep the helper implementation and API policy in `minecraft-jev` rather than duplicating them here.

Allow the short route to finish within the calling tool batch, then return its final `image` through `view_image` in that same batch. Keep intermediate captures as local evidence. On `fallback` or error, inspect the failed frame and diagnose it before another action; do not rerun the same plan blindly. The runner leaves the client alive, so resume it for subsequent work and stop it only when the task is complete.

Unknown screens, gameplay geometry, layout evaluation and visual feature correctness still need parent vision. Local text checks establish navigation state, not that a rendered feature looks correct. If switching back to native MCP clicks after the helper, capture once at the intended navigation width to establish that connection's coordinate scale.

## Skip failures already established on this build

For the installed **1.26.50.4** client, use these findings directly. Do not retest them on every new instance. A changed client/fork or a task explicitly testing the input path warrants one targeted check.

- **Text:** MCP `chat`/`type` now use [native_input.py](scripts/native_input.py) on the exact client's private display. The raw socket `text` command and Ctrl+A/selection deletion have repeatedly failed. For replacing an observed field, the helper's `--clear-chars N` uses BackSpaces. Lunar commands start with a dot; slash-first then `Home Delete period` is the established chat workaround. Read [controls](references/controls.md) on first use of this helper.
- **Buttons:** a tap may only establish focus. Use a short hover plus separate press/release across frames. A visible focus outline is useful state; activate that control with native Return where appropriate instead of hunting for different coordinates.
- **Join:** for a cold 854×480 client, use `launch` with `server_to_join: { name, address }`. It saves a new entry during startup or connects to an already saved host and port, confirms Minecraft's external-server prompt, and keeps any existing saved name. On a running client, call `add_server` with `join: true`; the add URI may save immediately, and the tool falls back to the form when it does not. Both tools return after requesting the connection, so verify the joined world or server response. If the documented connect URI stalls, inspect the frame and use the visible saved entry as the fallback; do not cycle URI variants or restart a healthy client.
- **Pack changes:** first confirm the intended pack downloaded. Restart only when the affected resource needs it; do not judge a stale render and recalibrate the feature against it.

## Recovery must change something

After two attempts without new visible progress, stop repeating the interaction. Inspect the current frame plus the one relevant diagnostic (focus, client log, or proxy listener/auth/version). Choose a specific fix or the established fallback, then resume the requested work. Do not reset this budget by relaunching or by renaming the same attempt. Network/loading progress can justify waiting; an unchanged menu cannot.

A routine screenshot task must not turn into keyboard-delay benchmarking, launcher development, or repeated proof polishing. If a valid frame was already captured but not persisted, finish all independent deliverable work first; allow at most one materially different recovery path to recreate it. If UI automation blocks a feature test, use an already-authorized fixture/configuration when it proves that same requirement. A fixture cannot prove the command UI works. If no valid route remains, report the precise blocked step and complete independent work.

## Read only the relevant details

- [Controls and native input](references/controls.md): input-helper usage, screenshot coordinates, and bounded recovery.
- [Installation](references/installation.md): launch failure, unavailable MCP tools, or client setup; includes the inventory command. Do not rebuild an SDK driver when native tools are available.
- [Lunar validation](references/lunar-validation.md): current test fixtures, module defaults, saved development credentials, and BDS updates. Match the requested verification scope.
- [Proof attachments](references/proof-attachments.md): only for requested GitHub evidence uploads.
- [Measured benchmarks](references/benchmarks.md): only for performance work or reruns, not ordinary captures.

If MCP or skill use reveals slowness or an edge case, improve this checkout and verify the
affected behavior. Agents with push permission can commit and push directly to
`RestartFU/minecraft-mcp` `main`; keep the installed skill linked to that same checkout so
the local copy updates with the push.
