import { expect, test } from "bun:test";
import { capacityIssues } from "./preflight.ts";

test("launch capacity leaves requested memory plus 2 GiB for the host", () => {
  const host = { availableMiB: 7000, load1: 1, cpus: 8, clients: 0 };
  expect(capacityIssues(host, 4096)).toEqual([]);
  expect(capacityIssues(host, 8192)).toContain("host RAM: 7000 MiB available; need 10240 MiB");
});

test("launch capacity includes clients owned by other MCP processes", () => {
  expect(capacityIssues({ availableMiB: 20000, load1: 1, cpus: 8, clients: 4 }))
    .toContain("client capacity: 4 running; maximum 4");
});

test("launch reserves the requested CPU quota as well as host headroom", () => {
  const host = { availableMiB: 20000, load1: 5, cpus: 8, clients: 0 };
  expect(capacityIssues(host, 4096, 250)).toEqual([]);
  expect(capacityIssues(host, 4096, 400)).toContain(
    "host CPU: 1-minute load 5 across 8 CPUs; need 4.0 spare CPUs",
  );
});
