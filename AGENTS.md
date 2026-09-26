# Minecraft MCP — agent guidelines

Bun + TypeScript MCP server over the `--agent-socket` of the bedrock-mc mcpelauncher fork
(github.com/bedrock-mc/mcpelauncher-manifest, local clone ~/Coding/other/mcpelauncher-manifest). The socket
protocol is documented in README.md; the server side is `mcpelauncher-client/src/agent_server.cpp` in the fork.

- New socket commands go in both places in the same change: `agent_server.cpp` and a tool in `src/index.ts`.
- `bun run scripts/smoke.ts` is the end-to-end check; it needs the fork's client installed
  and a signed-in game data dir. Check rendered menu readiness rather than using a fixed
  startup delay; a local 854×480, 20 FPS run showed a usable menu at about eight seconds.
- Never add clicking/typing into the game on the model's behalf beyond what the tools already do explicitly;
  every action stays a tool call the caller chose.
- Keep the launch capacity check and stale-client cleanup working when changing lifecycle
  behavior. Do not kill other tasks' clients outside the precise idle lease policy.
- If use reveals slowness or an edge case, make a focused verified improvement here. Agents
  with push permission may push directly to `RestartFU/minecraft-mcp` `main` after
  fast-forwarding and integrating concurrent changes. The installed skill must point to
  this checkout so the local copy updates at the same time.
