import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

export type Capacity = { availableMiB: number; load1: number; cpus: number; clients: number };
export const DEFAULT_CPU_QUOTA_PERCENT = 250;
export const DEFAULT_MEMORY_LIMIT_MIB = 4096;

export function capacityIssues(c: Capacity, memoryLimitMiB = DEFAULT_MEMORY_LIMIT_MIB, cpuQuotaPercent = DEFAULT_CPU_QUOTA_PERCENT): string[] {
  const issues: string[] = [];
  if (c.clients >= 4) issues.push(`client capacity: ${c.clients} running; maximum 4`);
  const requiredMiB = memoryLimitMiB + 2048;
  if (c.availableMiB < requiredMiB) issues.push(`host RAM: ${c.availableMiB} MiB available; need ${requiredMiB} MiB`);
  const neededSpareCpus = Math.max(c.cpus * 0.2, cpuQuotaPercent / 100);
  if (c.cpus - c.load1 < neededSpareCpus) {
    issues.push(`host CPU: 1-minute load ${c.load1} across ${c.cpus} CPUs; need ${neededSpareCpus.toFixed(1)} spare CPUs`);
  }
  return issues;
}

export async function preflight(memoryLimitMiB = DEFAULT_MEMORY_LIMIT_MIB, cpuQuotaPercent = DEFAULT_CPU_QUOTA_PERCENT) {
  const inventoryScript = fileURLToPath(new URL("../skills/minecraft-headless/scripts/client_inventory.py", import.meta.url));
  const inventory = Bun.spawn(["python3", inventoryScript], { stdout: "pipe", stderr: "pipe" });
  const [mem, load, output, error] = await Promise.all([
    readFile("/proc/meminfo", "utf8"),
    readFile("/proc/loadavg", "utf8"),
    new Response(inventory.stdout).text(),
    new Response(inventory.stderr).text(),
  ]);
  if ((await inventory.exited) !== 0) throw new Error(`cannot count Minecraft clients: ${error.trim()}`);
  const availableKiB = Number(mem.match(/^MemAvailable:\s+(\d+)/m)?.[1]);
  const load1 = Number(load.split(/\s+/)[0]);
  const cpus = availableParallelism();
  const clients = JSON.parse(output).total_clients as number;
  if (![availableKiB, cpus, clients].every((n) => Number.isFinite(n) && n >= 0) ||
      !Number.isFinite(load1) || load1 < 0 || cpus < 1 || availableKiB < 1) {
    throw new Error("cannot read valid host CPU, RAM, and client capacity measurements");
  }
  const capacity = { availableMiB: Math.floor(availableKiB / 1024), load1, cpus, clients };
  const issues = capacityIssues(capacity, memoryLimitMiB, cpuQuotaPercent);
  return { ok: issues.length === 0, capacity, issues };
}
