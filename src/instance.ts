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
  readonly proc: ChildProcess;
  readonly unitName?: string;
  gamePid = 0;
  socket!: AgentSocket;
  readonly log: string[] = [];
  // Scale from the last screenshot's pixels to window content pixels, so callers click on what they saw.
  shotScale = 1;

  private constructor(id: string, version: string, dataDir: string, socketPath: string, proc: ChildProcess, width: number, height: number, unitName?: string) {
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
    const commandArgs = unitName ? ["--user", "--wait", "--pipe", "--quiet", "--collect", `--unit=${unitName}`,
      "-p", `CPUQuota=${opts.cpuQuotaPercent}%`, "-p", `MemoryMax=${opts.memoryLimitMiB}M`, CLIENT, ...args] : args;
    const proc = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"], env: unitName ? userSystemdEnv() : process.env });
    const inst = new Instance(id, version, dataDir, socketPath, proc, opts.width, opts.height, unitName);
    inst.touch();
    const keep = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) if (line) inst.log.push(line);
      if (inst.log.length > 500) inst.log.splice(0, inst.log.length - 500);
    };
    proc.stdout!.on("data", keep);
    proc.stderr!.on("data", keep);
    const exited = new Promise<never>((_, reject) => proc.once("exit", (code) => reject(new Error(`client exited with code ${code}\n${inst.log.slice(-20).join("\n")}`))));
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
    writeFileSync(this.leasePath, JSON.stringify({ id: this.id, ownerPid: process.pid, lastUsed: Date.now() }), { mode: 0o600 });
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
    return (this.proc.exitCode === null && !this.proc.killed) || findClientPid(this.socketPath) !== 0;
  }

  private forceStop() {
    if (this.unitName) spawnSync("systemctl", ["--user", "stop", `${this.unitName}.service`], { stdio: "ignore", env: userSystemdEnv() });
    const gamePid = findClientPid(this.socketPath);
    if (gamePid) process.kill(gamePid, "SIGKILL");
    if (this.proc.exitCode === null) this.proc.kill("SIGKILL");
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
