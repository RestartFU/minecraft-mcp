#!/usr/bin/env bun
// One task-owned end-to-end run: launch, add a disposable server, join, capture proof, clean up.
// Usage: bun scripts/join_benchmark.ts --target 127.0.0.1:19153 [--mode saved|combined|direct-uri] [--cpu-quota-percent 250]
// `combined` measures one MCP add_server(join:true) call: Save -> connect URI -> verified Continue.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PNG } from "pngjs";
import { mainMenuReady } from "../src/menu_ready.ts";
import { nativeInput } from "../src/native_input.ts";

type Mode = "saved" | "combined" | "direct-uri";
type Options = { target: string; mode: Mode; output: string; dataDir: string; worldText?: string; timeoutMs: number; traceFirstFrames: boolean; cpuQuotaPercent: number };
type Frame = { path: string; png: Buffer; ms: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const baseData = process.env.MCPELAUNCHER_DATA ?? join(homedir(), ".var/app/io.mrarm.mcpelauncher/data/mcpelauncher");

export function parseOptions(argv: string[]): Options {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || !argv[i + 1]) throw new Error("Expected --name value pairs");
    args.set(argv[i].slice(2), argv[i + 1]);
  }
  for (const key of args.keys()) if (!["target", "mode", "output", "data-dir", "world-text", "timeout-ms", "trace-first-frames", "cpu-quota-percent"].includes(key)) throw new Error(`Unknown option --${key}`);
  const target = args.get("target") ?? "";
  if (!/^(?:[A-Za-z0-9.-]+):\d{1,5}$/.test(target)) throw new Error("--target HOST:PORT is required");
  const port = Number(target.split(":").at(-1));
  if (port < 1 || port > 65535) throw new Error("Target port must be 1–65535");
  const mode = args.get("mode") ?? "saved";
  if (mode !== "saved" && mode !== "combined" && mode !== "direct-uri") throw new Error("--mode must be saved, combined, or direct-uri");
  const output = args.get("output") ? resolve(args.get("output")!) : mkdtempSync(join(tmpdir(), "minecraft-join-bench-"));
  if (!output.startsWith(resolve(tmpdir()) + "/")) throw new Error("Benchmark evidence must stay under /tmp");
  const timeoutMs = Number(args.get("timeout-ms") ?? "90000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 180_000) throw new Error("--timeout-ms must be 5000–180000");
  const cpuQuotaPercent = Number(args.get("cpu-quota-percent") ?? "250");
  if (!Number.isInteger(cpuQuotaPercent) || cpuQuotaPercent < 50 || cpuQuotaPercent > 400) throw new Error("--cpu-quota-percent must be 50–400");
  const traceFirstFrames = args.get("trace-first-frames") === "yes";
  if (args.has("trace-first-frames") && !["yes", "no"].includes(args.get("trace-first-frames")!)) throw new Error("--trace-first-frames must be yes or no");
  return { target, mode, output, dataDir: resolve(args.get("data-dir") ?? baseData), worldText: args.get("world-text"), timeoutMs, traceFirstFrames, cpuQuotaPercent };
}

// Remove only the exact entry this run created, after the client has exited. Preserve unrelated entries.
export function withoutDisposableServer(content: string, name: string, host: string, port: number) {
  const lines = content.split(/(?<=\n)/);
  let removed = 0;
  const kept = lines.filter((line) => {
    const fields = line.trimEnd().split(":");
    const match = fields.length >= 5 && fields.at(-4) === name && fields.at(-3)?.toLowerCase() === host.toLowerCase() && Number(fields.at(-2)) === port;
    if (match) removed++;
    return !match;
  });
  if (removed > 1) throw new Error(`Refusing to remove ${removed} matching saved server entries`);
  return { content: kept.join(""), removed };
}

function alreadySaved(content: string, host: string, port: number) {
  return content.split(/\r?\n/).some((line) => {
    const fields = line.split(":");
    return fields.length >= 5 && fields.at(-3)?.toLowerCase() === host.toLowerCase() && Number(fields.at(-2)) === port;
  });
}

class LocalOCR {
  private proc: ChildProcessWithoutNullStreams;
  private lines: AsyncIterator<string>;
  private reader: Interface;

  constructor() {
    this.proc = spawn("python3", [join(import.meta.dir, "../skills/minecraft-jev/scripts/decide.py"), "--serve"], {
      stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    });
    this.reader = createInterface({ input: this.proc.stdout });
    this.lines = this.reader[Symbol.asyncIterator]();
  }

  async read(path: string, regions?: number[][]): Promise<string> {
    this.proc.stdin.write(JSON.stringify({ image: path, regions, mode: "ocr" }) + "\n");
    const line = await new Promise<IteratorResult<string>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Local OCR timed out")), 5_000);
      this.lines.next().then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
    if (line.done) throw new Error("Local OCR helper exited");
    const result = JSON.parse(line.value);
    if (result.error) throw new Error(`Local OCR: ${result.error}`);
    return result.observation as string;
  }

  close() { this.reader.close(); this.proc.kill(); }
}

// The title/Play/add-server menus all have a full-width bright header at y=30.
// A missing header alone is never counted as a successful join.
function menuHeader(png: Buffer) {
  const frame = PNG.sync.read(png);
  let bright = 0;
  for (let x = 80; x < frame.width - 80; x += 12) {
    const i = (30 * frame.width + x) * 4;
    if (frame.data[i] > 175 && frame.data[i + 1] > 175 && frame.data[i + 2] > 175) bright++;
  }
  return bright > (frame.width - 160) / 12 * 0.7;
}

function gameResources(pid: number) {
  const cgroupLine = readFileSync(`/proc/${pid}/cgroup`, "utf8").split("\n").find((line) => line.startsWith("0::"));
  if (!cgroupLine) throw new Error("Game process has no unified cgroup");
  const base = "/sys/fs/cgroup";
  const group = resolve(base, "." + cgroupLine.slice(3));
  if (!group.startsWith(base + "/")) throw new Error("Unexpected game cgroup path");
  const cpu = Object.fromEntries(readFileSync(join(group, "cpu.stat"), "utf8").trim().split("\n")
    .map((line) => { const [key, value] = line.trim().split(/\s+/); return [key, Number(value)]; }));
  return { cpu_usage_usec: cpu.usage_usec, cpu_throttled_usec: cpu.throttled_usec,
    cpu_nr_throttled: cpu.nr_throttled,
    cpu_max: readFileSync(join(group, "cpu.max"), "utf8").trim(),
    memory_current_bytes: Number(readFileSync(join(group, "memory.current"), "utf8").trim()),
    memory_max_bytes: readFileSync(join(group, "memory.max"), "utf8").trim() };
}

async function main() {
  const cfg = parseOptions(process.argv.slice(2));
  mkdirSync(cfg.output, { recursive: true });
  const host = cfg.target.split(":")[0];
  const port = Number(cfg.target.split(":")[1]);
  const id = `joinbench_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
  const name = `Bench${Date.now() % 10000}`;
  const file = join(cfg.dataDir, "games/com.mojang/minecraftpe/external_servers.txt");
  if (alreadySaved(readFileSync(file, "utf8"), host, port)) throw new Error("Target already appears in saved servers; use a fresh fixture port");
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  Object.assign(env, { MCPELAUNCHER_DATA: baseData, MCPELAUNCHER_ABI: process.env.MCPELAUNCHER_ABI ?? "x86_64",
    MCPELAUNCHER_CLIENT: process.env.MCPELAUNCHER_CLIENT ?? join(homedir(), ".local/bin/mcpelauncher-headless"),
    MCPELAUNCHER_SOCKET_DIR: process.env.MCPELAUNCHER_SOCKET_DIR ?? join(dirname(baseData), "s") });
  const client = new Client({ name: "minecraft-join-benchmark", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["run", join(import.meta.dir, "../src/index.ts")], env });
  const startedAtUtc = new Date().toISOString();
  const start = performance.now();
  let last = start;
  let launched = false;
  let gamePid = 0;
  let connected = false;
  let latest: Frame | undefined;
  let ocr: LocalOCR | undefined;
  let worldConfirmedAtUtc: string | undefined;
  const stages: Record<string, unknown>[] = [];
  let result: "confirmed_world" | "world_candidate" | "failed" = "failed";

  const mark = (stage: string, detail: Record<string, unknown> = {}) => {
    const now = performance.now();
    const row = { stage, at_utc: new Date().toISOString(), elapsed_ms: Math.round(now - start), delta_ms: Math.round(now - last), ...detail };
    last = now;
    stages.push(row);
    console.log(JSON.stringify(row));
    writeFileSync(join(cfg.output, "stages.json"), JSON.stringify(stages, null, 2));
  };
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 180_000 });
    const text = response.content.find((part) => part.type === "text")?.text ?? "{}";
    if (response.isError) throw new Error(`${tool}: ${text}`);
    return JSON.parse(text);
  };
  const capture = async (label: string): Promise<Frame> => {
    const before = performance.now();
    const response = await client.callTool({ name: "screenshot", arguments: { instance: id, width: 854 } });
    if (response.isError) throw new Error(`screenshot: ${response.content.find((part) => part.type === "text")?.text}`);
    const image = response.content.find((part) => part.type === "image");
    if (!image) throw new Error("Screenshot contained no image");
    const frame = { path: join(cfg.output, `${label}.png`), png: Buffer.from(image.data, "base64"), ms: performance.now() - before };
    writeFileSync(frame.path, frame.png);
    latest = frame;
    return frame;
  };
  const click = async (x: number, y: number) => {
    await call("mouse_move_to", { instance: id, x, y });
    await sleep(100);
    await call("click", { instance: id, x, y, action: "press" });
    try { await sleep(100); } finally { await call("click", { instance: id, action: "release" }); }
  };

  try {
    await client.connect(transport); connected = true; mark("mcp_connected");
    const capacity = await call("preflight");
    if (!capacity.ok) throw new Error(`Preflight refused launch: ${(capacity.issues ?? []).join("; ")}`);
    mark("preflight_passed");
    const launchedState = await call("launch", { id, data_dir: cfg.dataDir, width: 854, height: 480,
      fps_cap: 20, hidden: true, cpu_quota_percent: cfg.cpuQuotaPercent, memory_limit_mib: 4096, wait_for_menu: true });
    launched = true; gamePid = Number(launchedState.pid); mark("menu_ready", { pid: gamePid });
    await capture("menu");
    const addArgs = { instance: id, name, address: cfg.target, ...(cfg.mode === "combined" ? { join: true } : {}) };
    const added = await call("add_server", addArgs);
    if (!added.saved || added.already_exists) throw new Error("MCP did not add a new disposable server entry");
    if (added.name !== name || String(added.host).toLowerCase() !== host.toLowerCase() || Number(added.port) !== port) {
      throw new Error("MCP saved server fields did not match the requested name, host, and port");
    }
    if (cfg.mode === "combined" && (!added.joining || !added.prompt_confirmed)) {
      throw new Error("MCP did not verify and confirm the external-server prompt");
    }
    mark(cfg.mode === "combined" ? "external_server_confirmed" : "server_saved",
      cfg.mode === "combined" ? { method: "add_server_join" } : {});
    if (cfg.traceFirstFrames && cfg.mode !== "direct-uri") {
      await capture("post-add-0");
      await sleep(250);
      await capture("post-add-250");
      mark("post_add_trace_captured");
    }

    ocr = new LocalOCR();
    if (cfg.mode === "direct-uri") {
      await call("open_uri", { instance: id,
        uri: `minecraft://connect?serverUrl=${encodeURIComponent(host)}&serverPort=${port}` });
      mark("join_requested", { method: "connect_uri" });
      await capture("post-uri-0");
      await sleep(250);
      await capture("post-uri-250");
      mark("post_uri_trace_captured");
    }
    if (cfg.mode === "saved") {
      // On this client the Add Server form returns to the title menu after saving.
      // Open Play, then the Servers tab, before looking for the exact entry.
      await click(426, 269);
      let playVisible = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const frame = await capture("play-after-add");
        const observed = await ocr.read(frame.path, [[600, 48, 690, 75]]);
        if (normalize(observed).includes("server")) { playVisible = true; break; }
        await sleep(180);
      }
      if (!playVisible) throw new Error("Play screen did not appear after saved server was added");
      mark("play_screen_ready");
      let serversVisible = false;
      for (let clickAttempt = 0; clickAttempt < 2 && !serversVisible; clickAttempt++) {
        await nativeInput(id, "", [], [637, 62]);
        for (let poll = 0; poll < 5; poll++) {
          const frame = await capture("servers-tab");
          const observed = await ocr.read(frame.path, [[110, 75, 310, 135]]);
          const screen = normalize(observed);
          if (screen.includes("addserver") || screen.includes("featuredexperience")) { serversVisible = true; break; }
          await sleep(180);
        }
      }
      if (!serversVisible) throw new Error("Servers tab did not open after two native clicks");
      mark("servers_tab_opened");

      // Never click a guessed server row. Inspect the list, then move its scroll
      // thumb to the bottom if the new entry is not initially visible.
      let rowY = 0;
      let selectedFrame = await capture("servers-after-add");
      for (let scrolls = 0; scrolls <= 8 && !rowY; scrolls++) {
        for (let y = 145; y <= 455; y += 25) {
          const observed = await ocr.read(selectedFrame.path, [[115, Math.max(75, y - 12), 308, Math.min(478, y + 12)]]);
          if (normalize(observed).includes(normalize(name))) { rowY = y; break; }
        }
        if (rowY || scrolls === 8) break;
        if (scrolls === 0) {
          await call("mouse_move_to", { instance: id, x: 311, y: 105 });
          await call("click", { instance: id, x: 311, y: 105, action: "press" });
          try {
            await sleep(100);
            await call("mouse_move_to", { instance: id, x: 311, y: 445 });
            await sleep(100);
          } finally { await call("click", { instance: id, action: "release" }); }
        } else {
          await call("mouse_move_to", { instance: id, x: 205, y: 380 });
          await call("scroll", { instance: id, dy: -12 });
        }
        await sleep(180);
        selectedFrame = await capture(`servers-scroll-${scrolls + 1}`);
      }
      if (!rowY) throw new Error("Disposable server row was not recognized in bounded list scan");
      mark("saved_entry_visible", { row_y: rowY });
      await click(205, rowY);
      const detail = await capture("server-selected");
      const observation = await ocr.read(detail.path, [[320, 75, 750, 445]]);
      if (!normalize(observation).includes(normalize(name))) throw new Error("Selected server detail did not show the disposable name");
      mark("saved_entry_selected");
      await click(630, 216);
      mark("join_requested");
    }

    let candidate = 0;
    let leftMenu = false;
    let confirmedExternalServer = false;
    const deadline = performance.now() + cfg.timeoutMs;
    for (let index = 0; performance.now() < deadline; index++) {
      const frame = await capture("latest");
      const observation = await ocr.read(frame.path, cfg.worldText ? [[170, 130, 685, 350]] : undefined);
      const compact = normalize(observation);
      if (cfg.mode === "direct-uri" && !confirmedExternalServer && compact.includes("unknownexternalserver")) {
        writeFileSync(join(cfg.output, "external-server-prompt.png"), frame.png);
        mark("external_server_prompt", { screenshot: join(cfg.output, "external-server-prompt.png") });
        await nativeInput(id, "", [], [425, 264]);
        confirmedExternalServer = true;
        mark("external_server_confirmed");
        await capture("post-confirm-0");
        continue;
      }
      const titleVisible = mainMenuReady(frame.png.toString("base64"));
      const menuVisible = titleVisible || menuHeader(frame.png);
      if (!menuVisible && !leftMenu) {
        leftMenu = true;
        mark("left_menu", { note: "Pixel check only; this may be a prompt or loading screen" });
      }
      if (cfg.worldText && !menuVisible && compact.includes(normalize(cfg.worldText))
          && !compact.includes("youdied") && !compact.includes("respawn")) {
        result = "confirmed_world";
        worldConfirmedAtUtc = new Date().toISOString();
        writeFileSync(join(cfg.output, "world.png"), frame.png);
        mark("world_confirmed", { screenshot: join(cfg.output, "world.png") });
        break;
      }
      const transitional = /connecting|loading|generating|resourcepack|downloading|locatingserver|multiplayergame|unabletoconnect|server|play|settings|sign in/i.test(compact);
      if (!cfg.worldText && leftMenu && !menuVisible && !transitional) candidate++;
      else candidate = 0;
      if (candidate >= 3) {
        result = "world_candidate";
        writeFileSync(join(cfg.output, "world-candidate.png"), frame.png);
        mark("world_candidate", { screenshot: join(cfg.output, "world-candidate.png"), note: "Review screenshot before reporting a join" });
        break;
      }
      await sleep(300);
    }
    if (result === "failed") throw new Error("No world confirmation before timeout; inspect latest.png");
  } catch (error) {
    mark("failure", { error: String(error), screenshot: latest?.path });
    if (launched) {
      try {
        const response = await client.callTool({ name: "log", arguments: { instance: id, lines: 500 } });
        const raw = response.content.find((part) => part.type === "text")?.text ?? "";
        const lines = raw.split("\n").filter((line) => /connect|server|disconnect|raknet|join|auth|protocol|network/i.test(line));
        const scrubbed = lines.map((line) => line
          .replace(/\b(?:Bearer|XBL3\.0|token|password|secret|authorization)[^\n]*/ig, "[redacted credential line]")
          .replace(/\b[A-Za-z0-9_-]{48,}\b/g, "[redacted]")
          .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[redacted email]"));
        writeFileSync(join(cfg.output, "client-log-filtered.txt"), scrubbed.join("\n") + "\n", { mode: 0o600 });
      } catch (logError) { mark("log_capture_error", { error: String(logError) }); }
    }
  } finally {
    if (ocr) ocr.close();
    if (launched) {
      try { mark("resource_sample", gameResources(gamePid)); }
      catch (error) { mark("resource_sample_error", { error: String(error) }); }
      try { await call("stop", { instance: id }); mark("client_stopped"); }
      catch (error) { mark("stop_error", { error: String(error) }); }
    }
    if (connected) await client.close();
    try {
      const original = readFileSync(file, "utf8");
      const cleaned = withoutDisposableServer(original, name, host, port);
      if (cleaned.removed) {
        const temp = `${file}.${id}.tmp`;
        try {
          writeFileSync(temp, cleaned.content, { mode: statSync(file).mode });
          renameSync(temp, file);
        } finally { rmSync(temp, { force: true }); }
      }
      mark("saved_entry_cleanup", { removed: cleaned.removed });
    } catch (error) { mark("saved_entry_cleanup_error", { error: String(error) }); }
    const summary = { result, mode: cfg.mode, target: cfg.target, saved_name: name, world_text: cfg.worldText ?? null,
      started_at_utc: startedAtUtc, world_confirmed_at_utc: worldConfirmedAtUtc ?? null,
      server_input_delay_ms: Number(env.MINECRAFT_INPUT_DELAY_MS ?? "20"),
      generic_input_delay_ms: Number(env.MINECRAFT_INPUT_DELAY_MS ?? "50"), fps_cap: 20,
      cpu_quota_percent: cfg.cpuQuotaPercent,
      elapsed_ms: Math.round(performance.now() - start), output: cfg.output, final_frame: latest?.path,
      stages };
    writeFileSync(join(cfg.output, "result.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ result, elapsed_ms: summary.elapsed_ms, output: cfg.output, final_frame: latest?.path }));
  }
  if (result === "failed") process.exitCode = 1;
}

if (import.meta.main) await main();
