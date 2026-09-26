// Compare one client's steady menu CPU before and after enabling on-demand draws.
// Uses the same signed-in profile and stops the task-owned client on every exit path.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Instance } from "../src/instance.ts";
import { mainMenuReady } from "../src/menu_ready.ts";
import { preflight } from "../src/preflight.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ticksPerSecond = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
const cpuTicks = (pid: number) => {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(") ") + 2).trim().split(/\s+/);
  return Number(fields[11]) + Number(fields[12]);
};

const check = await preflight(4096, 150);
if (!check.ok) throw new Error(check.issues.join("; "));
const id = `render_bench_${process.pid}`;
let inst: Instance | undefined;
try {
  const launchedAt = performance.now();
  inst = await Instance.launch(id, { width: 854, height: 480, fpsCap: 20, hidden: true,
    cpuQuotaPercent: 150, memoryLimitMiB: 4096 });
  await inst.waitForMenu();
  console.log(JSON.stringify({ stage: "menu", ms: Math.round(performance.now() - launchedAt), pid: inst.gamePid }));

  const measure = async (label: string, onDemand: boolean, cap: number) => {
    await inst!.socket.call("fps", { cap });
    await inst!.socket.call("render", { on_demand: onDemand });
    await sleep(1000);
    const start = performance.now(), firstTicks = cpuTicks(inst!.gamePid);
    await sleep(6000);
    const elapsed = (performance.now() - start) / 1000;
    const cpuSeconds = (cpuTicks(inst!.gamePid) - firstTicks) / ticksPerSecond;
    const shotStart = performance.now();
    const shot = await inst!.socket.call("screenshot", { width: 426 });
    const png = Buffer.from(shot.png_base64 as string, "base64");
    writeFileSync(`/tmp/minecraft-${id}-${label}.png`, png);
    console.log(JSON.stringify({ label, cap, onDemand, elapsed: +elapsed.toFixed(2),
      cpuSeconds: +cpuSeconds.toFixed(2), cpuCorePercent: +((cpuSeconds / elapsed) * 100).toFixed(1),
      screenshotMs: Math.round(performance.now() - shotStart), menuReady: mainMenuReady(shot.png_base64 as string),
      pngSha256: createHash("sha256").update(png).digest("hex").slice(0, 16),
      fps: (await inst!.socket.call("state")).fps }));
  };
  // Account login and menu assets can keep loading after the first usable frame.
  await sleep(15_000);
  await measure("continuous_20", false, 20);
  await measure("on_demand_20", true, 20);
  await measure("continuous_20_again", false, 20);
  await measure("on_demand_20_again", true, 20);
  await measure("continuous_5", false, 5);
  await measure("on_demand_5", true, 5);
} finally {
  if (inst) await inst.stop(3000);
}
