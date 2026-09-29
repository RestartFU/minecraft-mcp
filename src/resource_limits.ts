import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The MCP host may omit the user-bus variables even when the login session is
// running. systemd-run/systemctl still need them to reach this user's scope.
export function userSystemdEnv(env: NodeJS.ProcessEnv = process.env, uid = process.getuid?.()): NodeJS.ProcessEnv {
  if (uid === undefined) throw new Error("user systemd scope requires a Unix user ID");
  const runtimeDir = env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  return {
    ...env,
    XDG_RUNTIME_DIR: runtimeDir,
    DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtimeDir}/bus`,
  };
}

// Flatpak moves the game out of the systemd-run service into its own app scope.
// The service properties still cap xvfb-run and its wrapper, but not Minecraft.
export function flatpakScope(cgroup: string): { unit: string; path: string } {
  const gamePath = cgroup.split("\n").find((line) => line.startsWith("0::"))?.slice(3);
  if (!gamePath?.startsWith("/")) throw new Error("Minecraft has no unified cgroup");
  const parts = gamePath.split("/");
  const index = parts.findIndex((part) => /^app-flatpak-io\.mrarm\.mcpelauncher-[A-Za-z0-9_.-]+\.scope$/.test(part));
  if (index < 0) throw new Error(`Minecraft is outside its expected Flatpak app scope: ${gamePath}`);
  return { unit: parts[index], path: parts.slice(0, index + 1).join("/") };
}

export function limitsActive(cpuMax: string, memoryMax: string, cpuQuotaPercent: number, memoryLimitMiB: number): boolean {
  const [quota, period] = cpuMax.trim().split(/\s+/).map(Number);
  const memory = Number(memoryMax.trim());
  return Number.isFinite(quota) && Number.isFinite(period) && period > 0 && quota > 0 &&
    quota / period <= cpuQuotaPercent / 100 + 0.0001 &&
    Number.isFinite(memory) && memory > 0 && memory <= memoryLimitMiB * 1024 * 1024;
}

function systemctl(...args: string[]): string {
  const result = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", timeout: 5000, env: userSystemdEnv() });
  if (result.error || result.status !== 0) {
    throw new Error(`systemctl ${args[0]} failed: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

export function limitFlatpakClient(pid: number, socketPath: string, cpuQuotaPercent: number, memoryLimitMiB: number) {
  const argv = readFileSync(`/proc/${pid}/cmdline`).toString().split("\0");
  if (!argv[0].split("/").at(-1)?.startsWith("mcpelauncher-client") || !argv.includes(socketPath)) {
    throw new Error("Minecraft process changed before resource limits were applied");
  }
  const scope = flatpakScope(readFileSync(`/proc/${pid}/cgroup`, "utf8"));
  if (systemctl("show", "--property=ControlGroup", "--value", scope.unit) !== scope.path) {
    throw new Error(`Minecraft Flatpak scope ${scope.unit} does not own its process cgroup`);
  }
  // A shared scope would make set-property affect another task's game. Flatpak
  // normally creates one scope per invocation; reject unexpected grouping.
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === pid) continue;
    let otherPath: string | undefined;
    try {
      const otherArgv = readFileSync(`/proc/${entry}/cmdline`).toString().split("\0");
      if (!otherArgv[0].split("/").at(-1)?.startsWith("mcpelauncher-client")) continue;
      otherPath = readFileSync(`/proc/${entry}/cgroup`, "utf8").split("\n").find((line) => line.startsWith("0::"))?.slice(3);
    } catch { continue; }
    if (otherPath === scope.path || otherPath?.startsWith(scope.path + "/")) {
      throw new Error(`Minecraft Flatpak scope ${scope.unit} also contains another game process`);
    }
  }
  systemctl("set-property", "--runtime", scope.unit, `CPUQuota=${cpuQuotaPercent}%`, `MemoryMax=${memoryLimitMiB}M`);
  const cgroupDir = join("/sys/fs/cgroup", scope.path);
  const cpuMax = readFileSync(join(cgroupDir, "cpu.max"), "utf8");
  const memoryMax = readFileSync(join(cgroupDir, "memory.max"), "utf8");
  if (!limitsActive(cpuMax, memoryMax, cpuQuotaPercent, memoryLimitMiB)) {
    throw new Error(`Minecraft Flatpak scope resource limits did not take effect (cpu.max=${cpuMax.trim()}, memory.max=${memoryMax.trim()})`);
  }
}
