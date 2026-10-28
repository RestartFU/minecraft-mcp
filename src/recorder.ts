import { mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Subprocess } from "bun";

const locateScript = fileURLToPath(new URL("../skills/minecraft-headless/scripts/native_input.py", import.meta.url));
const renderNode = process.env.MINECRAFT_VAAPI_DEVICE ?? "/dev/dri/renderD128";

interface Recording {
  proc: Subprocess<"pipe", "ignore", "pipe">;
  path: string;
  started: number;
  encoder: string;
  stderr: Promise<string>;
}

const recordings = new Map<string, Recording>();

interface GameWindow {
  display: string;
  xauthority: string;
  window: number;
}

/** Finds the instance's game window on its private X display. */
async function locate(instance: string): Promise<GameWindow> {
  if (!/^[a-zA-Z0-9_-]+$/.test(instance)) throw new Error("invalid Minecraft instance id");
  const proc = Bun.spawn(["python3", locateScript, "--instance", instance, "--locate"], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`cannot find the game window: ${err.trim() || out.trim()}`);
  return JSON.parse(out);
}

type Encoder = { name: string; container: "mp4" | "webm"; input: string[]; filter: string; output: string[] };
type Target = { quality: "record" | "share" } | { bitrate: number };

/**
 * Encoder arguments for one encode: near-lossless quality for a recording, or
 * a bitrate that fits a size limit for a shared cut.
 */
function encoderArgs(name: string, target: Target): Encoder {
  const vbr = (args: string[]) => ("bitrate" in target ? ["-b:v", `${target.bitrate}`, "-maxrate", `${target.bitrate}`, "-bufsize", `${target.bitrate * 2}`] : args);
  const vaapi = { input: ["-vaapi_device", renderNode], filter: "format=nv12,hwupload" };
  const soft = { input: [], filter: "format=yuv420p" };
  switch (name) {
    case "h264_vaapi":
      return { name, container: "mp4", ...vaapi, output: ["-c:v", name, ...vbr(["-qp", "20"])] };
    case "libx264":
      return { name, container: "mp4", ...soft, output: ["-c:v", name, "-preset", "veryfast", ...vbr(["-crf", "20"])] };
    case "av1_vaapi":
      return { name, container: "mp4", ...vaapi, output: ["-c:v", name, ...vbr(["-qp", "90"])] };
    case "libsvtav1":
      return { name, container: "mp4", ...soft, output: ["-c:v", name, "-preset", "10", ...vbr(["-crf", "28"])] };
    case "libvpx-vp9": {
      // Realtime keeps a live capture ahead of the game; a shared cut can take longer.
      const speed = "quality" in target && target.quality === "record" ? ["-deadline", "realtime", "-cpu-used", "8"] : ["-deadline", "good", "-cpu-used", "4"];
      return { name, container: "webm", ...soft, output: ["-c:v", name, ...speed, "-row-mt", "1", ...vbr(["-crf", "28", "-b:v", "0"])] };
    }
  }
  throw new Error(`unknown encoder ${name}`);
}

// Recording favours speed; a shared cut favours what Discord and browsers play
// inline: H.264, then VP9, with AV1 last.
const recordEncoders = ["h264_vaapi", "av1_vaapi", "libx264", "libsvtav1", "libvpx-vp9"];
const shareEncoders = ["h264_vaapi", "libx264", "libvpx-vp9", "av1_vaapi", "libsvtav1"];
const working = new Map<string, Promise<boolean>>();

/**
 * Reports whether an encoder actually encodes on this host. A listed encoder
 * may still fail: Fedora lists h264_vaapi and libopenh264 without enabling them.
 */
function works(name: string): Promise<boolean> {
  let result = working.get(name);
  if (!result) {
    const enc = encoderArgs(name, { quality: "record" });
    const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", ...enc.input, "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30",
      "-t", "0.3", "-vf", enc.filter, ...enc.output, "-f", "null", "-"], { stdout: "ignore", stderr: "ignore" });
    result = proc.exited.then((code) => code === 0, () => false);
    working.set(name, result);
  }
  return result;
}

async function encodeArgs(order: string[], target: Target): Promise<Encoder> {
  for (const name of order) {
    if (await works(name)) return encoderArgs(name, target);
  }
  throw new Error(`ffmpeg on the MCP host has no working video encoder (${order.join(", ")})`);
}

const absolute = (path: string, name: string) => {
  if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path on the MCP host`);
  return path;
};

/** Starts recording the instance's game window to a Matroska file. */
export async function startRecording(instance: string, path: string, fps: number) {
  if (recordings.has(instance)) throw new Error(`instance ${instance} is already recording`);
  absolute(path, "save_path");
  const win = await locate(instance);
  const enc = await encodeArgs(recordEncoders, { quality: "record" });
  await mkdir(dirname(path), { recursive: true });
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...enc.input,
    "-f", "x11grab", "-framerate", `${fps}`, "-draw_mouse", "0", "-window_id", `${win.window}`, "-i", win.display,
    "-vf", enc.filter, ...enc.output, "-g", `${fps * 2}`, path,
  ], { stdin: "pipe", stdout: "ignore", stderr: "pipe", env: { ...process.env, DISPLAY: win.display, XAUTHORITY: win.xauthority } });
  const recording: Recording = { proc, path, started: Date.now(), encoder: enc.name, stderr: new Response(proc.stderr).text() };
  // A capture that cannot start exits at once; report it instead of a silent empty file.
  const early = await Promise.race([proc.exited, Bun.sleep(2000).then(() => undefined)]);
  if (early !== undefined) throw new Error(`recording failed to start: ${(await recording.stderr).trim()}`);
  recordings.set(instance, recording);
  return { recording: true, path, encoder: enc.name, fps, display: win.display, window: win.window };
}

/** Stops the instance's recording and reports the finished file. */
export async function stopRecording(instance: string) {
  const recording = recordings.get(instance);
  if (!recording) throw new Error(`instance ${instance} is not recording`);
  recordings.delete(instance);
  recording.proc.stdin.write("q");
  await recording.proc.stdin.end();
  const code = await Promise.race([recording.proc.exited, Bun.sleep(30_000).then(() => undefined)]);
  if (code === undefined) {
    recording.proc.kill("SIGINT");
    await recording.proc.exited;
  }
  const size = (await stat(recording.path).catch(() => undefined))?.size ?? 0;
  return { path: recording.path, bytes: size, seconds: Math.round((Date.now() - recording.started) / 1000), encoder: recording.encoder, ffmpeg_errors: (await recording.stderr).trim().slice(-2000) };
}

/** Stops every recording this MCP process started, for shutdown. */
export async function stopAllRecordings() {
  await Promise.allSettled([...recordings.keys()].map(stopRecording));
}

/** Reports the instance's running recording, if any. */
export async function recordingStatus(instance: string) {
  const recording = recordings.get(instance);
  if (!recording) return { recording: false };
  const size = (await stat(recording.path).catch(() => undefined))?.size ?? 0;
  return { recording: true, path: recording.path, bytes: size, seconds: Math.round((Date.now() - recording.started) / 1000), encoder: recording.encoder };
}

async function run(args: string[]) {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${args[0]} failed: ${err.trim().slice(-2000)}`);
  return Buffer.from(out);
}

async function duration(path: string) {
  const out = await run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]);
  const seconds = Number(out.toString().trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`cannot read the duration of ${path}`);
  return seconds;
}

/** Extracts one frame of a video as a PNG, scaled to width. */
export async function videoFrame(input: string, atSeconds: number, width: number) {
  absolute(input, "input");
  const png = await run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", `${atSeconds}`, "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-f", "image2pipe", "-c:v", "png", "-"]);
  if (png.length === 0) throw new Error(`no frame at ${atSeconds}s in ${input}`);
  return { png, duration: await duration(input) };
}

/**
 * Speeds a recording up into a video that fits maxMb, dropping frames rather
 * than blending them, at the given output frame rate and height. The file
 * extension follows the codec: .mp4, or .webm for VP9.
 */
export async function videoTimelapse(input: string, output: string, speed: number, maxMb: number, fps: number, height: number) {
  absolute(input, "input");
  absolute(output, "output");
  const seconds = (await duration(input)) / speed;
  // Leave room for the container and encoder overshoot.
  const bitrate = Math.max(500_000, Math.floor((maxMb * 1024 * 1024 * 8 * 0.9) / seconds));
  const enc = await encodeArgs(shareEncoders, { bitrate });
  const path = output.replace(/\.[^./]*$/, "") + `.${enc.container}`;
  await mkdir(dirname(path), { recursive: true });
  await run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...enc.input, "-i", input,
    "-vf", `setpts=PTS/${speed},fps=${fps},scale=-2:${height},${enc.filter}`, "-an", ...enc.output,
    ...(enc.container === "mp4" ? ["-movflags", "+faststart"] : []), path,
  ]);
  const size = (await stat(path)).size;
  return { path, bytes: size, seconds: Math.round(seconds), bitrate, encoder: enc.name, content_type: enc.container === "mp4" ? "video/mp4" : "video/webm" };
}

/**
 * Uploads a file to a pre-signed URL, such as an upload URL a service issued
 * for one attachment. Only https URLs are accepted, and no credentials are
 * added: the URL itself must authorize the upload.
 */
export async function uploadFile(path: string, url: string, method: "PUT" | "POST", contentType: string) {
  absolute(path, "path");
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("upload URL must use https");
  const file = Bun.file(path);
  const res = await fetch(target, { method, body: file, headers: { "Content-Type": contentType, "Content-Length": `${file.size}` } });
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
  return { uploaded: true, bytes: file.size, status: res.status };
}
