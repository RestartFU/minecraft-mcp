// Bounded live check: one task-owned client, always stopped before exit.
import { writeFileSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Instance } from "../src/instance.ts";
import { preflight } from "../src/preflight.ts";

const check = await preflight();
if (!check.ok) throw new Error(check.issues.join("; "));
const id = `bench_${process.pid}`;
const t0 = performance.now();
let inst: Instance | undefined;
try {
  inst = await Instance.launch(id, { width: 854, height: 480, fpsCap: 20, hidden: true,
    cpuQuotaPercent: 150, memoryLimitMiB: 4096 });
  console.log(JSON.stringify({ stage: "launched", ms: Math.round(performance.now() - t0),
    pid: inst.gamePid, unit: inst.unitName }));
  await inst.waitForMenu();
  console.log(JSON.stringify({ stage: "menu", ms: Math.round(performance.now() - t0) }));
  const t1 = performance.now();
  const state = await inst.socket.call("state");
  console.log(JSON.stringify({ stage: "state", ms: Math.round(performance.now() - t1), state }));
  const t2 = performance.now();
  const shot = await inst.socket.call("screenshot", { width: 854 });
  writeFileSync(`/tmp/minecraft-mcp-${id}.png`, Buffer.from(shot.png_base64 as string, "base64"));
  console.log(JSON.stringify({ stage: "screenshot", ms: Math.round(performance.now() - t2),
    bytes: Buffer.byteLength(shot.png_base64 as string, "base64") }));
  const stat = readFileSync(`/proc/${inst.gamePid}/status`, "utf8");
  console.log(JSON.stringify({ stage: "resources", rssKiB: Number(stat.match(/^VmRSS:\s+(\d+)/m)?.[1]),
    fpsCap: (await inst.socket.call("state")).fps_cap }));
} finally {
  if (inst) {
    const t = performance.now();
    await inst.stop(3000);
    console.log(JSON.stringify({ stage: "stopped", ms: Math.round(performance.now() - t) }));
  }
}
