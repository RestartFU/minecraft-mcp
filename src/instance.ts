import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSocket } from "./socket.ts";
import { mainMenuReady } from "./menu_ready.ts";
import { limitFlatpakClient, userSystemdEnv } from "./resource_limits.ts";

const APP = process.env.MCPELAUNCHER_APP ?? "/Applications/Minecraft Bedrock Launcher.app";
const DATA = process.env.MCPELAUNCHER_DATA ?? join(homedir(), "Library/Application Support/mcpelauncher");
export const DEFAULT_DATA_DIR = DATA;
const ABI = process.env.MCPELAUNCHER_ABI ?? "arm64-v8a";
const CLIENT = process.env.MCPELAUNCHER_CLIENT ?? join(APP, "Contents/MacOS", `mcpelauncher-client-${ABI}`);
const SOCKET_DIR = process.env.MCPELAUNCHER_SOCKET_DIR ?? tmpdir();

export interface LaunchOptions {
  version?: string;
  dataDir?: string;
  startupUri?: string;
  width: number;
  height: number;
  fpsCap: number;
  hidden: boolean;
  cpuQuotaPercent: number;
  memoryLimitMiB: number;
}

export function installedVersions(): string[] {
  const dir = join(DATA, "versions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((v) => existsSync(join(dir, v, "lib", ABI, "libminecraftpe.so")))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

// One running game client plus its control socket; instances are isolated by data dir so several can run.
export class Instance {
  readonly id: string;
  readonly version: string;
  readonly dataDir: string;
  readonly width: number;
  readonly height: number;
  readonly socketPath: string;
  readonly leasePath: string;
  // proc is the launcher this connection spawned; an adopted client has none.
  readonly proc?: ChildProcess;
  readonly unitName?: string;
  gamePid = 0;
  socket!: AgentSocket;
  private readonly piped: string[] = [];
  // Scale from the last screenshot's pixels to window content pixels, so callers click on what they saw.
  shotScale = 1;

  private constructor(id: string, version: string, dataDir: string, socketPath: string, proc: ChildProcess | undefined, width: number, height: number, unitName?: string) {
    this.id = id;
    this.version = version;
    this.dataDir = dataDir;
    this.width = width;
    this.height = height;
    this.socketPath = socketPath;
    this.leasePath = `${socketPath}.lease.json`;
    this.proc = proc;
    this.unitName = unitName;
  }

  static async launch(id: string, opts: LaunchOptions): Promise<Instance> {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("instance id may contain only letters, numbers, hyphens, and underscores");
    const versions = installedVersions();
    const version = opts.version ?? versions[0];
    if (!version || !versions.includes(version)) {
      throw new Error(`version ${opts.version ?? "(none)"} not installed; available: ${versions.join(", ") || "none"}`);
    }
    const dataDir = opts.dataDir ?? DATA;
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(SOCKET_DIR, { recursive: true });
    const socketPath = join(SOCKET_DIR, `mcpelauncher-agent-${id}.sock`);
    if (findClientPid(socketPath)) throw new Error(`instance id ${id} is already used by another Minecraft client`);
    const modsDir = join(DATA, "mods/mcpelauncher-updates", version, ABI);
    const args = [
      "-dg", join(DATA, "versions", version),
      "-dd", dataDir,
      "-ww", String(opts.width), "-wh", String(opts.height),
      "--agent-socket", socketPath,
      "--fps-cap", String(opts.fpsCap),
    ];
    if (opts.startupUri) args.push("--uri", opts.startupUri);
    if (opts.hidden) args.push("--hidden");
    if (existsSync(modsDir)) args.push("-m", modsDir + "/");
    const unitName = process.platform === "linux" ? `minecraft-mcp-${id}-${process.pid}` : undefined;
    const command = unitName ? "systemd-run" : CLIENT;
    // The client logs to the journal, not to a pipe into this process, so it
    // outlives this MCP connection and a later one can adopt it.
    const commandArgs = unitName ? ["--user", "--wait", "--quiet", "--collect", `--unit=${unitName}`,
      "-p", `CPUQuota=${opts.cpuQuotaPercent}%`, "-p", `MemoryMax=${opts.memoryLimitMiB}M`, CLIENT, ...args] : args;
    const proc = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"], env: unitName ? userSystemdEnv() : process.env });
    const inst = new Instance(id, version, dataDir, socketPath, proc, opts.width, opts.height, unitName);
    inst.touch();
    const keep = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) if (line) inst.piped.push(line);
      if (inst.piped.length > 500) inst.piped.splice(0, inst.piped.length - 500);
    };
    proc.stdout!.on("data", keep);
    proc.stderr!.on("data", keep);
    const exited = new Promise<never>((_, reject) => proc.once("exit", (code) => reject(new Error(`client exited with code ${code}\n${inst.log(20).join("\n")}`))));
    try {
      inst.socket = await Promise.race([AgentSocket.connect(socketPath, 90_000), exited]);
      inst.gamePid = findClientPid(socketPath);
      if (!inst.gamePid) throw new Error(`client for ${id} has no matching process`);
      if (unitName) limitFlatpakClient(inst.gamePid, socketPath, opts.cpuQuotaPercent, opts.memoryLimitMiB);
    } catch (error) {
      inst.forceStop();
      rmSync(inst.leasePath, { force: true });
      throw error;
    }
    return inst;
  }

  touch() {
    const lease: Lease = { id: this.id, ownerPid: process.pid, lastUsed: Date.now(), unitName: this.unitName, version: this.version, width: this.width, height: this.height };
    writeFileSync(this.leasePath, JSON.stringify(lease), { mode: 0o600 });
  }

  /**
   * Adopts the running client with this id that this connection did not
   * launch, such as one an MCP connection that has since closed left behind.
   * It returns undefined when no such client runs, and refuses one a live
   * connection still owns.
   */
  static async adopt(id: string): Promise<Instance | undefined> {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return undefined;
    const socketPath = join(SOCKET_DIR, `mcpelauncher-agent-${id}.sock`);
    const gamePid = findClientPid(socketPath);
    if (!gamePid) return undefined;
    const lease = readLease(`${socketPath}.lease.json`);
    if (lease?.ownerPid && lease.ownerPid !== process.pid && processAlive(lease.ownerPid)) {
      throw new Error(`instance ${id} belongs to another live MCP connection (pid ${lease.ownerPid})`);
    }
    const argv = readFileSync(`/proc/${gamePid}/cmdline`).toString().split("\0");
    const flag = (name: string) => argv[argv.indexOf(name) + 1];
    const socket = await AgentSocket.connect(socketPath, 5_000);
    const state = await socket.call("state").catch(() => ({} as Record<string, unknown>));
    const width = Number(state.width ?? lease?.width ?? flag("-ww"));
    const height = Number(state.height ?? lease?.height ?? flag("-wh"));
    const version = lease?.version ?? flag("-dg")?.split("/").at(-1) ?? "unknown";
    const inst = new Instance(id, version, flag("-dd") ?? DATA, socketPath, undefined, width, height, lease?.unitName);
    inst.socket = socket;
    inst.gamePid = gamePid;
    inst.touch();
    return inst;
  }

  /** Lists running clients no live MCP connection owns, which adopt can take over. */
  static orphans(): string[] {
    if (!existsSync(SOCKET_DIR)) return [];
    const ids: string[] = [];
    for (const name of readdirSync(SOCKET_DIR)) {
      const match = /^mcpelauncher-agent-([a-zA-Z0-9_-]+)\.sock$/.exec(name);
      if (!match) continue;
      const socketPath = join(SOCKET_DIR, name);
      const lease = readLease(`${socketPath}.lease.json`);
      if (findClientPid(socketPath) && !(lease?.ownerPid && processAlive(lease.ownerPid))) ids.push(match[1]);
    }
    return ids;
  }

  /** Recent client log lines: the unit's journal, or the launcher's pipe. */
  log(lines: number): string[] {
    if (this.unitName) {
      const out = spawnSync("journalctl", ["--user", "-u", `${this.unitName}.service`, "-n", String(lines), "-o", "cat", "--no-pager"],
        { encoding: "utf8", env: userSystemdEnv() });
      if (out.status === 0) return out.stdout.split("\n").filter(Boolean);
    }
    return this.piped.slice(-lines);
  }

  // FPS becomes nonzero on the loading screen. Inspect the actual menu instead of
  // adding a fixed delay after the first rendered frame.
  async waitForMenu(timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let seen = false;
    while (Date.now() < deadline) {
      const shot = await this.socket.call("screenshot", { width: 426 });
      if (mainMenuReady(shot.png_base64 as string)) {
        if (seen) {
          // Switch the first input from keyboard to mouse mode before returning.
          await this.socket.call("mouse_pos", { x: this.width * 0.7, y: this.height * 0.83 });
          return;
        }
        seen = true;
      } else {
        seen = false;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Minecraft main menu was not visible within ${timeoutMs} ms`);
  }

  get alive() {
    return (this.proc !== undefined && this.proc.exitCode === null && !this.proc.killed) || findClientPid(this.socketPath) !== 0;
  }

  /** Lets the client keep running after this connection closes, for adoption. */
  release() {
    this.socket?.close();
    writeFileSync(this.leasePath, JSON.stringify({ ...readLease(this.leasePath), ownerPid: 0 }), { mode: 0o600 });
  }

  private forceStop() {
    if (this.unitName) spawnSync("systemctl", ["--user", "stop", `${this.unitName}.service`], { stdio: "ignore", env: userSystemdEnv() });
    const gamePid = findClientPid(this.socketPath);
    if (gamePid) process.kill(gamePid, "SIGKILL");
    if (this.proc && this.proc.exitCode === null) this.proc.kill("SIGKILL");
  }

  async stop(graceMs = 35_000) {
    if (!this.alive) {
      rmSync(this.leasePath, { force: true });
      return;
    }
    try {
      await this.socket.send("quit");
    } catch {}
    const deadline = Date.now() + graceMs;
    while (findClientPid(this.socketPath) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (this.alive) this.forceStop();
    this.socket.close();
    rmSync(this.leasePath, { force: true });
  }
}

interface Lease {
  id: string;
  ownerPid: number;
  lastUsed: number;
  unitName?: string;
  version?: string;
  width?: number;
  height?: number;
}

function readLease(path: string): Lease | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function findClientPid(socketPath: string): number {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const argv = readFileSync(`/proc/${entry}/cmdline`).toString().split("\0");
      if (argv.includes(socketPath) && argv[0].split("/").at(-1)?.startsWith("mcpelauncher-client")) return Number(entry);
    } catch {}
  }
  return 0;
}
