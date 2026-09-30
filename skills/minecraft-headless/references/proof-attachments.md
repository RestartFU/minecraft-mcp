# GitHub proof attachments


Keep validation screenshots, recordings, logs, and proof-only README files outside every repository and worktree. Do not copy, stage, or commit them into the project, including under `docs/proofs/`, or create a Git branch or repository just to host them.

When the user requests proof on a GitHub PR or issue, upload the captures as GitHub attachments using an available upload tool or GitHub's attachment UI. Embed the returned attachment URLs in the requested PR or issue and verify they display. A GitHub blob/raw URL backed by a committed file is not an attachment.

Persist the first valid in-game proof before stopping or changing the client. Pass
an absolute `save_path` outside the repository to the MCP `screenshot` tool so the
same captured PNG is both saved and returned inline:

```json
{"instance":"task-id","width":854,"save_path":"/tmp/task-evidence/proof.png"}
```

Verify that saved frame before stopping the client. On an older MCP connection
without `save_path`, Minecraft's own screenshot action writes an artifact outside
the repository:

```bash
python /home/danick/.codex/skills/minecraft-headless/scripts/native_input.py \
  --instance task-id --keys F2
```

For the F2 fallback, locate the newest PNG under the active profile's `games/com.mojang/screenshots/` directory and verify it matches the inline MCP frame. Do not assume an image returned inline by the MCP can be recovered later. If F2 is unavailable, use a screenshot tool that directly saves the current private display; establish the output path before stopping the client.

Opening the PR, preparing its body, committing, and pushing do not depend on recreating proof. Complete those independent steps before attempting recovery of a missed artifact. A missed artifact gets one materially different recovery route; do not restart healthy clients, duplicate saved servers, or cycle through URI/input variants solely to polish proof.

If attachment upload is unavailable or fails, retain the local artifacts and report the upload blocker. Do not fall back to committing proof files. This rule concerns validation evidence, not production assets the user asks to add to the project.
