#!/usr/bin/env bun
// Local MCP benchmark. Uses a dedicated profile; screenshots require visual review.
import { Client } from "/home/danick/.local/share/minecraft-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "/home/danick/.local/share/minecraft-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import { mkdir, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";

const [profileArg, outputArg, trialsArg = "3"] = process.argv.slice(2);
const trials = Number(trialsArg);
if (!profileArg || !outputArg || !Number.isInteger(trials) || trials < 1 || trials > 10) {
  throw new Error("Usage: bun benchmark.ts DEDICATED_PROFILE OUTPUT_DIR [trials=3]");
}
const data = "/home/danick/.var/app/io.mrarm.mcpelauncher/data/mcpelauncher";
await mkdir(profileArg, { recursive: true });
const profile = await realpath(profileArg);
if (profile === await realpath(data)) throw new Error("Use a dedicated profile, not the shared login profile");
if (!profile.startsWith(resolve(data, "..") + "/")) throw new Error("Profile must be inside the Flatpak shared data directory");
const output = resolve(outputArg);
await mkdir(output, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>;
Object.assign(env, { MCPELAUNCHER_CLIENT: "/home/danick/.local/bin/mcpelauncher-headless",
  MCPELAUNCHER_DATA: data, MCPELAUNCHER_ABI: "x86_64",
  MCPELAUNCHER_SOCKET_DIR: resolve(data, "../s") });
const client = new Client({ name: "minecraft-skill-benchmark", version: "1.0.0" });
const transport = new StdioClientTransport({ command: "/home/danick/.local/bin/bun",
  args: ["run", "/home/danick/.local/share/minecraft-mcp/src/index.ts"], env });
const rows: Record<string, unknown>[] = [];
let owned: string | undefined;
async function call(name: string, args: Record<string, unknown> = {}) {
  const start = performance.now();
  const result: any = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  const ms = performance.now() - start;
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
  return { result, ms };
}
async function requireClientCapacity() {
  const inventory = Bun.spawn(["python", resolve(import.meta.dir, "client_inventory.py"),
    "--require-capacity", "4"], { stdout: "pipe", stderr: "pipe" });
  const [inventoryOutput, inventoryError, inventoryExit] = await Promise.all([
    new Response(inventory.stdout).text(), new Response(inventory.stderr).text(), inventory.exited]);
  if (inventoryExit !== 0) throw new Error(`Client capacity check failed: ${inventoryOutput || inventoryError}`);
}
function value(result: any) { return JSON.parse(result.content.find((c: any) => c.type === "text").text); }
async function capture(instance: string, label: string) {
  const { result, ms } = await call("screenshot", { instance, width: 854 });
  const img = result.content.find((c: any) => c.type === "image");
  if (!img) throw new Error("Missing screenshot");
  const path = join(output, `${label}.png`);
  await Bun.write(path, Buffer.from(img.data, "base64"));
  return { path, ms };
}
try {
  await client.connect(transport);
  for (let trial = 0; trial < trials; trial++) {
    // Alternate order to reduce warm-cache/order bias.
    for (const wait_for_menu of (trial % 2 ? [false, true] : [true, false])) {
      const id = `skillbench-${process.pid}-${trial}-${wait_for_menu ? "default" : "fast"}`;
      const start = performance.now();
      await requireClientCapacity();
      owned = id;
      const launch = await call("launch", { id, data_dir: profile, width: 854, height: 480,
        fps_cap: 30, hidden: true, wait_for_menu });
      let state = value(launch.result);
      const deadline = performance.now() + 30_000;
      while (state.fps <= 0 && performance.now() < deadline) {
        await Bun.sleep(250);
        state = value((await call("state", { instance: id })).result);
      }
      if (state.fps <= 0) throw new Error("No rendered frame within 30 seconds after launch");
      const firstRenderObservedMs = performance.now() - start;
      // Controlled benchmark allowance, not a general readiness predicate.
      // The first benchmark proved fps>0 still showed a 40% loading screen.
      // Preserve that frame, then review the menu and accepted-action frames.
      await capture(id, `${id}-first-render`);
      if (!wait_for_menu) await Bun.sleep(4000);
      // Capture before any input, then exercise the known 854x480 menu target.
      const before = await capture(id, `${id}-before`);
      const beforeInputMs = performance.now() - start;
      await call("mouse_move_to", { instance: id, x: 426, y: 269 });
      await Bun.sleep(100);
      await call("click", { instance: id, x: 426, y: 269, action: "press" });
      await Bun.sleep(100);
      await call("click", { instance: id, action: "release" });
      await Bun.sleep(1500);
      const after = await capture(id, `${id}-after`);
      const row = { trial, wait_for_menu, launch_ms: launch.ms, first_render_observed_ms: firstRenderObservedMs,
        before_input_ms: beforeInputMs, fast_render_allowance_ms: wait_for_menu ? 0 : 4000,
        after_input_ms: performance.now() - start, before: before.path, after: after.path,
        note: "Review images: fps>0 and tool success do not establish menu readiness or click acceptance." };
      rows.push(row);
      await Bun.write(join(output, "launch.json"), JSON.stringify(rows, null, 2));
      console.log(JSON.stringify(row));
      await call("stop", { instance: id });
      owned = undefined;
    }
  }
} finally {
  if (owned) {
    try { await call("stop", { instance: owned }); } catch (error) { console.error(`Cleanup failed: ${error}`); }
  }
  await client.close();
}
