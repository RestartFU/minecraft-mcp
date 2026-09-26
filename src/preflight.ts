import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

export type Capacity = { availableMiB: number; load1: number; cpus: number; clients: number };

export function capacityIssues(c: Capacity, memoryLimitMiB = 4096): string[] {
  const issues: string[] = [];
  if (c.clients >= 4) issues.push(`client capacity: ${c.clients} running; maximum 4`);
  const requiredMiB = memoryLimitMiB + 2048;
  if (c.availableMiB < requiredMiB) issues.push(`host RAM: ${c.availableMiB} MiB available; need ${requiredMiB} MiB`);
  if (c.load1 > c.cpus * 0.8) issues.push(`host CPU: 1-minute load ${c.load1} across ${c.cpus} CPUs; need 20% spare capacity`);
  return issues;
}

export async function preflight(memoryLimitMiB = 4096) {
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
  const issues = capacityIssues(capacity, memoryLimitMiB);
  return { ok: issues.length === 0, capacity, issues };
}
