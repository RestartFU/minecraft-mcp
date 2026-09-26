#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Instance, installedVersions } from "./instance.ts";
import { preflight } from "./preflight.ts";
import { nativeInput } from "./native_input.ts";
import { addServer } from "./add_server.ts";

const instances = new Map<string, Instance>();
let current: string | undefined;

function pick(id?: string): Instance {
  const key = id ?? current;
  const inst = key ? instances.get(key) : undefined;
  if (!inst || !inst.alive) throw new Error(key ? `instance ${key} is not running` : "no running instance; call launch first");
  inst.touch();
  return inst;
}

const text = (s: unknown) => ({ content: [{ type: "text" as const, text: typeof s === "string" ? s : JSON.stringify(s) }] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const instanceArg = { instance: z.string().optional().describe("Instance id; defaults to the most recently launched") };

const server = new McpServer({ name: "mcpelauncher-agent", version: "0.1.0" });

server.tool("preflight", "Check host CPU, RAM, and global Minecraft client capacity before launch", {}, async () => text(await preflight()));

server.tool(
  "launch",
  "Start a real Minecraft Bedrock client (via mcpelauncher) with the agent socket attached",
  {
    id: z.string().default("main").describe("Instance id, unique per running client"),
    version: z.string().optional().describe("Installed game version; defaults to the newest"),
    data_dir: z.string().optional().describe("Separate data dir (own Xbox login, worlds, settings) for running several bots"),
    width: z.number().int().min(320).default(854),
    height: z.number().int().min(180).default(480),
    fps_cap: z.number().int().min(0).default(20).describe("Render cap; 20 FPS limits CPU for routine work; game ticks are independent"),
    hidden: z.boolean().default(true).describe("Keep the window hidden (still renders for screenshots)"),
    cpu_quota_percent: z.number().int().min(50).max(400).default(150).describe("Per-client CPU quota on Linux; 100 = one CPU core"),
    memory_limit_mib: z.number().int().min(1024).max(8192).default(4096).describe("Per-client memory limit on Linux, in MiB"),
    wait_for_menu: z.boolean().default(false).describe("Default false returns when the window exists. True waits for two visible main menu frames"),
  },
  async ({ id, version, data_dir, width, height, fps_cap, hidden, cpu_quota_percent, memory_limit_mib, wait_for_menu }) => {
    if (instances.get(id)?.alive) throw new Error(`instance ${id} already running`);
    const check = await preflight(memory_limit_mib);
    if (!check.ok) throw new Error(`not enough capacity to launch: ${check.issues.join("; ")}`);
    const inst = await Instance.launch(id, { version, dataDir: data_dir, width, height, fpsCap: fps_cap, hidden,
      cpuQuotaPercent: cpu_quota_percent, memoryLimitMiB: memory_limit_mib });
    instances.set(id, inst);
    current = id;
    if (wait_for_menu) {
      try {
        await inst.waitForMenu();
      } catch (error) {
        await inst.stop(5_000);
        instances.delete(id);
        current = [...instances.keys()].pop();
        throw error;
      }
    }
    const state = await inst.socket.call("state");
    return text({ instance: id, version: inst.version, pid: inst.gamePid, cpu_quota_percent, memory_limit_mib, ...state });
  },
);

server.tool("stop", "Quit a running client (in-game quit, force-killed after 35s)", instanceArg, async ({ instance }) => {
  const inst = pick(instance);
  await inst.stop();
  instances.delete(inst.id);
  if (current === inst.id) current = [...instances.keys()].pop();
  return text({ stopped: inst.id });
});

server.tool("list", "List installed game versions and running instances", {}, async () =>
  text({
    versions: installedVersions(),
    instances: [...instances.values()].filter((i) => i.alive).map((i) => ({ id: i.id, version: i.version, pid: i.gamePid, data_dir: i.dataDir })),
    current,
  }),
);

server.tool("state", "Window size, focus, measured fps and cursor lock", instanceArg, async ({ instance }) => text(await pick(instance).socket.call("state")));

server.tool(
  "screenshot",
  "Capture the current frame as PNG",
  { ...instanceArg, width: z.number().int().min(64).optional().describe("Downscale to this width (aspect kept); default = window size") },
  async ({ instance, width }) => {
    const inst = pick(instance);
    const res = await inst.socket.call("screenshot", width ? { width } : {});
    inst.shotScale = (res.source_width as number) / (res.width as number);
    return { content: [{ type: "image" as const, data: res.png_base64 as string, mimeType: "image/png" }, { type: "text" as const, text: `${res.width}x${res.height} (click coordinates are in this image's pixels)` }] };
  },
);

const keySchema = z.string().describe("Key name: a-z, 0-9, f1-f12, space, enter, escape, tab, shift, ctrl, alt, up/down/left/right, ...");

server.tool(
  "key",
  "Press a key (tap by default; use action press/release to hold across calls)",
  { ...instanceArg, key: keySchema, action: z.enum(["tap", "press", "release"]).default("tap"), hold_ms: z.number().int().min(1).default(60), mods: z.array(z.enum(["shift", "ctrl", "alt", "super"])).optional() },
  async ({ instance, ...args }) => text(await pick(instance).socket.call("key", args)),
);

server.tool(
  "hold_key",
  "Hold a key for a duration (walking: w/a/s/d, jump: space, sneak: shift, sprint: ctrl)",
  { ...instanceArg, key: keySchema, ms: z.number().int().min(1).max(60_000) },
  async ({ instance, key, ms }) => {
    const inst = pick(instance);
    await inst.socket.call("key", { key, action: "press" });
    await sleep(ms);
    await inst.socket.call("key", { key, action: "release" });
    return text({ ok: true, key, ms });
  },
);

server.tool("type", "Type text into the focused field with the client's private Xvfb keyboard", { ...instanceArg, text: z.string() }, async ({ instance, text: t }) => {
  const inst = pick(instance);
  return text(await nativeInput(inst.id, t));
});

server.tool("chat", "Open chat, type a message and send it", { ...instanceArg, message: z.string() }, async ({ instance, message }) => {
  const inst = pick(instance);
  await inst.socket.call("key", { key: "t" });
  await sleep(400);
  return text(await nativeInput(inst.id, message, ["Return"]));
});

server.tool("look", "Turn the camera by a relative mouse delta (pixels)", { ...instanceArg, dx: z.number(), dy: z.number() }, async ({ instance, dx, dy }) => text(await pick(instance).socket.call("mouse_move", { dx, dy })));

server.tool(
  "click",
  "Click at coordinates in the last screenshot's pixels (or at the last position). left = attack/break, right = use/place",
  { ...instanceArg, button: z.enum(["left", "right", "middle"]).default("left"), x: z.number().optional(), y: z.number().optional(), action: z.enum(["tap", "press", "release"]).default("tap"), hold_ms: z.number().int().min(1).default(60) },
  async ({ instance, x, y, ...args }) => {
    const inst = pick(instance);
    const scaled = x !== undefined && y !== undefined ? { x: x * inst.shotScale, y: y * inst.shotScale } : {};
    return text(await inst.socket.call("click", { ...args, ...scaled }));
  },
);

server.tool("mouse_move_to", "Move the cursor to coordinates in the last screenshot's pixels (menus; in-world use look)", { ...instanceArg, x: z.number(), y: z.number() }, async ({ instance, x, y }) => {
  const inst = pick(instance);
  return text(await inst.socket.call("mouse_pos", { x: x * inst.shotScale, y: y * inst.shotScale }));
});

server.tool("scroll", "Scroll the mouse wheel (hotbar / lists)", { ...instanceArg, dy: z.number() }, async ({ instance, dy }) => text(await pick(instance).socket.call("scroll", { dy })));

server.tool(
  "add_server",
  "Add an external server through the in-game form and confirm it was saved (854×480 clients)",
  { ...instanceArg, name: z.string(), address: z.string().describe("host or host:port (default port 19132)") },
  async ({ instance, name, address }) => text(await addServer(pick(instance), name, address)),
);

server.tool(
  "open_uri",
  "Send a raw minecraft: URI to the game (deep links: servers, worlds, marketplace)",
  { ...instanceArg, uri: z.string().describe("Must start with minecraft:") },
  async ({ instance, uri }) => text(await pick(instance).socket.call("uri", { uri })),
);

server.tool("set_fps", "Change the render cap at runtime (0 = uncapped while focused)", { ...instanceArg, cap: z.number().int().min(0) }, async ({ instance, cap }) => text(await pick(instance).socket.call("fps", { cap })));

server.tool("wait", "Wait for the game to catch up", { ms: z.number().int().min(1).max(60_000) }, async ({ ms }) => {
  await sleep(ms);
  return text({ ok: true });
});

server.tool("log", "Recent client log lines", { ...instanceArg, lines: z.number().int().min(1).max(500).default(50) }, async ({ instance, lines }) => text(pick(instance).log.slice(-lines).join("\n")));

async function stopAll() {
  await Promise.all([...instances.values()].map((i) => i.stop(5_000)));
  process.exit(0);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

await server.connect(new StdioServerTransport());
