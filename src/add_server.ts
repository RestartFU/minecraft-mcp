import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Instance } from "./instance.ts";
import { nativeInput } from "./native_input.ts";
import { addServerFormReady, externalServerPromptReady, serversTabReady } from "./menu_ready.ts";

// The Add Server form saved exact fields and joined in two 20 ms trials at 20 FPS.
// Other text widgets retain the more conservative native-input default.
const serverInput = (inst: Instance, value: string, click: [number, number], clearChars = 0) =>
  nativeInput(inst.id, value, [], click, clearChars, 20);

async function waitForScreen(inst: Instance, ready: (pngBase64: string) => boolean, label: string) {
  const deadline = Date.now() + 15_000;
  let seen = false;
  while (Date.now() < deadline) {
    const shot = await inst.socket.call("screenshot", { width: 854 });
    if (ready(shot.png_base64 as string)) {
      if (seen) return;
      seen = true;
    } else {
      seen = false;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Minecraft did not display the ${label}; inspect the current screen`);
}

export function serverTarget(address: string): { host: string; port: number } {
  const match = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(address.trim());
  if (!match) throw new Error("server address must be a hostname or IPv4 address, with an optional port");
  const port = match[2] ? Number(match[2]) : 19132;
  if (port < 1 || port > 65535) throw new Error("server port must be 1–65535");
  return { host: match[1], port };
}

async function savedName(inst: Instance, host: string, port: number): Promise<string | undefined> {
  const file = join(inst.dataDir, "games/com.mojang/minecraftpe/external_servers.txt");
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  for (const line of content.split(/\r?\n/)) {
    const fields = line.split(":");
    if (fields.length >= 5 && fields.at(-3)?.toLowerCase() === host.toLowerCase() && Number(fields.at(-2)) === port) {
      return fields.slice(1, -3).join(":");
    }
  }
  return undefined;
}

export async function addServer(inst: Instance, name: string, address: string, join = false) {
  if (inst.width !== 854 || inst.height !== 480) {
    throw new Error("add_server currently requires an 854×480 client; launch with the default dimensions");
  }
  if (!name.trim() || name.length > 64 || [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) {
    throw new Error("server name must contain 1–64 printable ASCII characters");
  }
  const { host, port } = serverTarget(address);
  const existing = await savedName(inst, host, port);
  if (existing !== undefined) {
    if (join) await connectToServer(inst, host, port);
    return { saved: true, already_exists: true, joining: join, prompt_confirmed: join, name: existing, host, port };
  }

  // The deep link opens the Servers tab. Minecraft still requires completing its form.
  await inst.socket.call("uri", { uri: `minecraft://?addExternalServer=${encodeURIComponent(name)}|${host}:${port}` });
  await waitForScreen(inst, serversTabReady, "Servers tab");
  await serverInput(inst, "", [200, 98]);
  await waitForScreen(inst, addServerFormReady, "Add Server form");
  await serverInput(inst, name, [300, 80]);
  await serverInput(inst, host, [300, 130]);
  if (port !== 19132) await serverInput(inst, String(port), [300, 180], 5);
  await serverInput(inst, "", [300, 220]);

  for (let i = 0; i < 10; i++) {
    const stored = await savedName(inst, host, port);
    if (stored !== undefined) {
      if (stored !== name) throw new Error(`Minecraft saved server name ${JSON.stringify(stored)} instead of ${JSON.stringify(name)}`);
      if (join) await connectToServer(inst, host, port);
      return { saved: true, already_exists: false, joining: join, prompt_confirmed: join, name, host, port };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Minecraft did not save the server; inspect the current screen for a form error");
}

async function connectToServer(inst: Instance, host: string, port: number) {
  await inst.socket.call("uri", { uri: `minecraft://connect?serverUrl=${encodeURIComponent(host)}&serverPort=${port}` });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const shot = await inst.socket.call("screenshot", { width: 854 });
    if (externalServerPromptReady(shot.png_base64 as string)) {
      await serverInput(inst, "", [425, 265]);
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Minecraft did not show the external-server confirmation; inspect the current screen");
}
