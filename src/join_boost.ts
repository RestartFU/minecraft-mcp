import type { Instance } from "./instance.ts";

// The client loads a joined world's resources a slice per frame, so the routine 20 FPS cap
// also slows the join: on a software-rendered 854x480 client a cold join reached the world
// in 22-27 s at 20 FPS and 18-19 s at 60 FPS. Joins therefore run at a higher cap and drop
// back to the requested one once the player is in the world.
const DEFAULT_JOIN_BOOST_FPS = 60;
const RESTORE_POLL_MS = 500;
const RESTORE_TIMEOUT_MS = 120_000;

/** Join render cap from MINECRAFT_JOIN_BOOST_FPS; 0 disables the boost. */
export function joinBoostFps(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MINECRAFT_JOIN_BOOST_FPS;
  if (raw === undefined || raw === "") return DEFAULT_JOIN_BOOST_FPS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 240) throw new Error("MINECRAFT_JOIN_BOOST_FPS must be an integer from 0 to 240");
  return value;
}

/** The cap to use while joining: the boost, unless it is off or the requested cap is already higher or uncapped. */
export function boostedCap(requested: number, boost = joinBoostFps()): number {
  if (boost === 0 || requested === 0 || requested >= boost) return requested;
  return boost;
}

type Restore = { cap: number; cancelled: boolean };
const restores = new Map<Instance, Restore>();

/** Raises a running client's cap for a join and returns the cap to restore afterwards. */
export async function boostRunningClient(inst: Instance): Promise<number> {
  const pending = restores.get(inst);
  const state = await inst.socket.call("state");
  // A join started during another join's boost restores to the original cap, not the boost.
  const current = pending?.cap ?? Number(state.fps_cap ?? 20);
  cancelRestore(inst);
  const cap = boostedCap(current);
  if (cap !== Number(state.fps_cap)) await inst.socket.call("fps", { cap });
  return current;
}

/**
 * Restores `cap` once the player is in the world (the game locks the cursor) or after the
 * timeout, whichever comes first. It runs in the background so join tools return as before.
 */
export function restoreWhenInWorld(inst: Instance, cap: number, timeoutMs = RESTORE_TIMEOUT_MS): void {
  cancelRestore(inst);
  const restore: Restore = { cap, cancelled: false };
  restores.set(inst, restore);
  void (async () => {
    const deadline = Date.now() + timeoutMs;
    while (!restore.cancelled && inst.alive && Date.now() < deadline) {
      const state = await inst.socket.call("state").catch(() => undefined);
      if (state?.cursor_locked) break;
      await new Promise((r) => setTimeout(r, RESTORE_POLL_MS));
    }
    await finish(inst, restore);
  })();
}

/** Restores immediately, such as after a failed join. */
export async function restoreNow(inst: Instance, cap: number): Promise<void> {
  cancelRestore(inst);
  const restore: Restore = { cap, cancelled: false };
  restores.set(inst, restore);
  await finish(inst, restore);
}

/** An explicit set_fps wins over a pending restore. */
export function cancelRestore(inst: Instance): void {
  const restore = restores.get(inst);
  if (restore) restore.cancelled = true;
  restores.delete(inst);
}

/**
 * Applies every pending restore now. A closing MCP connection calls this instead of waiting,
 * because a lingering process would keep the client's lease and block the next connection
 * from adopting it.
 */
export async function flushRestores(): Promise<void> {
  await Promise.allSettled([...restores.entries()].map(([inst, restore]) => finish(inst, restore)));
}

async function finish(inst: Instance, restore: Restore): Promise<void> {
  if (restore.cancelled || restores.get(inst) !== restore) return;
  restores.delete(inst);
  if (inst.alive) await inst.socket.call("fps", { cap: restore.cap }).catch(() => undefined);
}
