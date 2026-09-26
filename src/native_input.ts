import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../skills/minecraft-headless/scripts/native_input.py", import.meta.url));

export async function nativeInput(instance: string, value: string, keys: string[] = [], click?: [number, number], clearChars = 0, preferredDelayMs = 50) {
  if (!/^[a-zA-Z0-9_-]+$/.test(instance)) throw new Error("invalid Minecraft instance id");
  if ([...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) {
    throw new Error("native text input supports printable ASCII only");
  }
  const delayMs = Number(process.env.MINECRAFT_INPUT_DELAY_MS ?? preferredDelayMs);
  if (!Number.isInteger(delayMs) || delayMs < 10 || delayMs > 100) {
    throw new Error("MINECRAFT_INPUT_DELAY_MS must be an integer from 10 to 100");
  }
  const proc = Bun.spawn(["python3", script, "--instance", instance, "--text", value,
    "--delay-ms", String(delayMs), ...(click ? ["--click", ...click.map(String)] : []),
    ...(clearChars ? ["--clear-chars", String(clearChars)] : []),
    ...(keys.length ? ["--keys", ...keys] : [])], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`native Minecraft input failed: ${err.trim() || out.trim()}`);
  return JSON.parse(out);
}
