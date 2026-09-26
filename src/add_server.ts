import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Instance } from "./instance.ts";
import { nativeInput } from "./native_input.ts";

export function serverTarget(address: string): { host: string; port: number } {
  const match = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(address.trim());
  if (!match) throw new Error("server address must be a hostname or IPv4 address, with an optional port");
  const port = match[2] ? Number(match[2]) : 19132;
  if (port < 1 || port > 65535) throw new Error("server port must be 1–65535");
  return { host: match[1], port };
}

async function saved(inst: Instance, host: string, port: number): Promise<boolean> {
  const file = join(inst.dataDir, "games/com.mojang/minecraftpe/external_servers.txt");
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  return content.split(/\r?\n/).some((line) => {
    const fields = line.split(":");
    return fields.length >= 5 && fields.at(-3)?.toLowerCase() === host.toLowerCase() && Number(fields.at(-2)) === port;
  });
}

export async function addServer(inst: Instance, name: string, address: string) {
  if (inst.width !== 854 || inst.height !== 480) {
    throw new Error("add_server currently requires an 854×480 client; launch with the default dimensions");
  }
  if (!name.trim() || name.length > 64 || [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) {
    throw new Error("server name must contain 1–64 printable ASCII characters");
  }
  const { host, port } = serverTarget(address);
  if (await saved(inst, host, port)) return { saved: true, already_exists: true, host, port };

  // The deep link opens the Servers tab. Minecraft still requires completing its form.
  await inst.socket.call("uri", { uri: `minecraft://?addExternalServer=${encodeURIComponent(name)}|${host}:${port}` });
  await new Promise((r) => setTimeout(r, 1000));
  await nativeInput(inst.id, "", [], [200, 98]);
  await new Promise((r) => setTimeout(r, 300));
  await nativeInput(inst.id, name, [], [300, 80]);
  await nativeInput(inst.id, host, [], [300, 130]);
  if (port !== 19132) await nativeInput(inst.id, String(port), [], [300, 180], 5);
  await nativeInput(inst.id, "", [], [300, 220]);

  for (let i = 0; i < 10; i++) {
    if (await saved(inst, host, port)) return { saved: true, already_exists: false, host, port };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Minecraft did not save the server; inspect the current screen for a form error");
}
