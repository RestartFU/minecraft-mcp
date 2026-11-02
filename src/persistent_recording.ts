import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface Capture {
  pid: number;
  identity: string;
  path: string;
  started: number;
  encoder: string;
  errors: string;
  starting?: boolean;
}

/** Resolves private state for an instance without accepting path components. */
function paths(instance: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(instance)) throw new Error("invalid Minecraft instance id");
  const dir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "minecraft-mcp", "recordings");
  return { dir, metadata: join(dir, `${instance}.json`), errors: join(dir, `${instance}.stderr`) };
}

/** Identifies a live Linux process across PID reuse; zombies are already finished. */
async function identity(pid: number): Promise<string | undefined> {
  try {
    const value = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = value.slice(value.lastIndexOf(")") + 2).trim().split(/\s+/);
    return fields[0] === "Z" || fields[0] === "X" ? undefined : fields[19];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Loads a durable capture, including a start reservation held by its creator. */
async function load(instance: string): Promise<Capture | undefined> {
  try {
    const value: Capture = JSON.parse(await readFile(paths(instance).metadata, "utf8"));
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || !value.identity || !value.path || !value.errors) {
      throw new Error("invalid persistent recording metadata");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Reads only a bounded diagnostic tail, even after a long capture. */
async function errorsTail(path: string) {
  const file = await open(path, "r").catch(() => undefined);
  if (!file) return "";
  try {
    const size = (await file.stat()).size;
    const buffer = Buffer.alloc(Math.min(2000, size));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return buffer.subarray(0, bytesRead).toString().trim();
  } finally {
    await file.close();
  }
}

/** Reports a capture left by an earlier connection without adopting an unrelated PID. */
export async function persistentRecordingStatus(instance: string) {
  const capture = await load(instance);
  if (!capture) return { recording: false };
  const current = await identity(capture.pid);
  const recording = current === capture.identity;
  return {
    recording, persistent: true, starting: capture.starting ?? false,
    path: capture.path, bytes: (await stat(capture.path).catch(() => undefined))?.size ?? 0,
    seconds: Math.round((Date.now() - capture.started) / 1000), encoder: capture.encoder,
  };
}

/** Starts a detached capture whose lifetime is independent of the MCP connection. */
export async function startPersistentRecording(instance: string, path: string, encoder: string, args: string[], env: NodeJS.ProcessEnv) {
  if (process.platform !== "linux") throw new Error("persistent recording requires Linux process identity support");
  const files = paths(instance);
  await mkdir(files.dir, { recursive: true, mode: 0o700 });
  const previous = await load(instance);
  if (previous) {
    if (await identity(previous.pid) === previous.identity) throw new Error(`instance ${instance} is already recording`);
    throw new Error(`instance ${instance} has a finished persistent recording; call record_stop first`);
  }
  const reservation: Capture = { pid: process.pid, identity: (await identity(process.pid))!, path, encoder, started: Date.now(), errors: files.errors, starting: true };
  const metadata = await open(files.metadata, "wx", 0o600);
  let proc: ReturnType<typeof spawn> | undefined;
  let processIdentity: string | undefined;
  let ready = false;
  try {
    await metadata.writeFile(JSON.stringify(reservation));
    const errors = await open(files.errors, "w", 0o600);
    try {
      proc = spawn(args[0], args.slice(1), { detached: true, stdio: ["ignore", "ignore", errors.fd], env });
      await new Promise<void>((resolve, reject) => { proc!.once("spawn", resolve); proc!.once("error", reject); });
      processIdentity = await identity(proc.pid!);
      if (!processIdentity) throw new Error("recording exited before its process could be identified");
      proc.unref();
    } finally {
      await errors.close();
    }
    const capture: Capture = { ...reservation, pid: proc.pid!, identity: processIdentity, starting: false };
    const temp = `${files.metadata}.${process.pid}.tmp`;
    await Bun.write(temp, JSON.stringify(capture), { mode: 0o600 });
    await rename(temp, files.metadata);
    await Bun.sleep(2000);
    if (await identity(capture.pid) !== capture.identity) throw new Error(`recording failed to start: ${await errorsTail(files.errors)}`);
    ready = true;
    return { recording: true, persistent: true, path, encoder };
  } finally {
    await metadata.close();
    if (!ready) {
      if (proc?.pid && processIdentity && await identity(proc.pid) === processIdentity) process.kill(proc.pid, "SIGINT");
      await unlink(files.metadata).catch(() => {});
    }
  }
}

/** Finalizes a detached capture, signalling only the exact process that started it. */
export async function stopPersistentRecording(instance: string) {
  const capture = await load(instance);
  if (!capture) throw new Error(`instance ${instance} is not recording`);
  if (capture.starting) throw new Error("recording is still starting; retry record_stop shortly");
  const current = await identity(capture.pid);
  if (current && current !== capture.identity) throw new Error("recording process identity changed; refusing to signal a reused PID");
  if (current) {
    process.kill(capture.pid, "SIGINT");
    const deadline = Date.now() + 30_000;
    while (await identity(capture.pid) === capture.identity && Date.now() < deadline) await Bun.sleep(100);
    if (await identity(capture.pid) === capture.identity) {
      process.kill(capture.pid, "SIGKILL");
      throw new Error("recording did not finalize within 30 seconds");
    }
  }
  const result = { path: capture.path, bytes: (await stat(capture.path).catch(() => undefined))?.size ?? 0,
    seconds: Math.round((Date.now() - capture.started) / 1000), encoder: capture.encoder, persistent: true,
    ffmpeg_errors: await errorsTail(capture.errors) };
  await unlink(paths(instance).metadata);
  return result;
}
