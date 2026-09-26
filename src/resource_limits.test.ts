import { expect, test } from "bun:test";
import { flatpakScope, limitsActive } from "./resource_limits.ts";

const gameScope = "/user.slice/user-1000.slice/user@1000.service/app.slice/app-flatpak-io.mrarm.mcpelauncher-95828203.scope";

test("resource limits target the game's exact Flatpak scope", () => {
  expect(flatpakScope(`0::${gameScope}\n`)).toEqual({
    unit: "app-flatpak-io.mrarm.mcpelauncher-95828203.scope",
    path: gameScope,
  });
  expect(flatpakScope(`0::${gameScope}/payload\n`).path).toBe(gameScope);
  expect(() => flatpakScope("0::/user.slice/user-1000.slice/user@1000.service/app.slice/t3code.service\n"))
    .toThrow("outside its expected Flatpak app scope");
  expect(() => flatpakScope("0::/app.slice/app-flatpak-org.example.other-95828203.scope\n"))
    .toThrow("outside its expected Flatpak app scope");
});

test("launch rejects an uncapped game cgroup", () => {
  expect(limitsActive("150000 100000", "4294967296", 150, 4096)).toBe(true);
  expect(limitsActive("max 100000", "4294967296", 150, 4096)).toBe(false);
  expect(limitsActive("150000 100000", "max", 150, 4096)).toBe(false);
  expect(limitsActive("200000 100000", "4294967296", 150, 4096)).toBe(false);
  expect(limitsActive("150000 100000", "8589934592", 150, 4096)).toBe(false);
});
