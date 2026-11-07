import { describe, expect, test } from "bun:test";
import type { Instance } from "./instance.ts";
import { boostRunningClient, boostedCap, cancelRestore, flushRestores, joinBoostFps, restoreNow, restoreWhenInWorld } from "./join_boost.ts";

// A client whose agent socket records fps calls and reports a scripted cursor state.
function fakeClient(fpsCap = 20) {
  const calls: number[] = [];
  const client = {
    alive: true, cursorLocked: false, fpsCap, calls,
    socket: {
      call: async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "fps") { client.fpsCap = Number(args.cap); calls.push(client.fpsCap); return { ok: true }; }
        return { ok: true, cursor_locked: client.cursorLocked, fps_cap: client.fpsCap };
      },
    },
  };
  return client;
}
const asInstance = (c: ReturnType<typeof fakeClient>) => c as unknown as Instance;
const until = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20)); };

describe("join boost caps", () => {
  test("boosts only caps below the boost", () => {
    expect(boostedCap(20, 60)).toBe(60);
    expect(boostedCap(60, 60)).toBe(60);
    expect(boostedCap(90, 60)).toBe(90);
    expect(boostedCap(0, 60)).toBe(0); // uncapped stays uncapped
    expect(boostedCap(20, 0)).toBe(20); // boost disabled
  });

  test("reads MINECRAFT_JOIN_BOOST_FPS", () => {
    expect(joinBoostFps({})).toBe(60);
    expect(joinBoostFps({ MINECRAFT_JOIN_BOOST_FPS: "0" })).toBe(0);
    expect(joinBoostFps({ MINECRAFT_JOIN_BOOST_FPS: "45" })).toBe(45);
    expect(() => joinBoostFps({ MINECRAFT_JOIN_BOOST_FPS: "fast" })).toThrow();
  });
});

describe("join boost restore", () => {
  test("restores the requested cap once the player is in the world", async () => {
    const c = fakeClient(60);
    restoreWhenInWorld(asInstance(c), 20, 10_000);
    await new Promise((r) => setTimeout(r, 50));
    expect(c.fpsCap).toBe(60); // still loading
    c.cursorLocked = true;
    await until(() => c.fpsCap === 20);
    expect(c.calls).toEqual([20]);
  });

  test("restores after the timeout when the cursor never locks", async () => {
    const c = fakeClient(60);
    restoreWhenInWorld(asInstance(c), 20, 100);
    await until(() => c.fpsCap === 20);
    expect(c.calls).toEqual([20]);
  });

  test("an explicit set_fps cancels the pending restore", async () => {
    const c = fakeClient(60);
    restoreWhenInWorld(asInstance(c), 20, 150);
    cancelRestore(asInstance(c));
    await new Promise((r) => setTimeout(r, 700));
    expect(c.calls).toEqual([]);
  });

  test("a failed join restores immediately", async () => {
    const c = fakeClient(60);
    await restoreNow(asInstance(c), 20);
    expect(c.calls).toEqual([20]);
  });

  test("a closing connection applies pending restores at once", async () => {
    const c = fakeClient(60);
    restoreWhenInWorld(asInstance(c), 20, 60_000);
    await flushRestores();
    expect(c.calls).toEqual([20]);
  });

  test("boosting a running client remembers its own cap, even mid-boost", async () => {
    const c = fakeClient(20);
    expect(await boostRunningClient(asInstance(c))).toBe(20);
    expect(c.fpsCap).toBe(60);
    restoreWhenInWorld(asInstance(c), 20, 60_000);
    expect(await boostRunningClient(asInstance(c))).toBe(20); // second join keeps the original cap
    await flushRestores();
    expect(c.calls).toEqual([60]); // the first restore was superseded, nothing pending
  });
});
