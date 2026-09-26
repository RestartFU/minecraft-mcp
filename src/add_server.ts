import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Instance } from "./instance.ts";
import { nativeInput } from "./native_input.ts";
import { addServerFormReady, externalServerPromptPresent, externalServerPromptReady, mainMenuReady, serversTabReady } from "./menu_ready.ts";

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

export function externalServerUri(name: string, address: string): string {
  if (!name.trim() || name.length > 64 || [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) {
    throw new Error("server name must contain 1–64 printable ASCII characters");
  }
  // The launcher decodes the whole URI query before passing it to Bedrock.
  // Delimiters encoded inside the name would therefore become query syntax.
  if (/[|&=#?]/.test(name)) throw new Error("server name cannot contain |, &, =, #, or ? in this client");
  const { host, port } = serverTarget(address);
  return `minecraft://?addExternalServer=${encodeURIComponent(name)}|${host}:${port}`;
}

export function serverConnectUri(address: string): string {
  const { host, port } = serverTarget(address);
  return `minecraft://connect?serverUrl=${encodeURIComponent(host)}&serverPort=${port}`;
}

async function savedName(dataDir: string, host: string, port: number): Promise<string | undefined> {
  const file = join(dataDir, "games/com.mojang/minecraftpe/external_servers.txt");
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

export async function savedServerName(dataDir: string, address: string): Promise<string | undefined> {
  const { host, port } = serverTarget(address);
  return savedName(dataDir, host, port);
}

export async function addServer(inst: Instance, name: string, address: string, join = false, connectRequestedAtStartup = false) {
  const started = performance.now();
  const timings_ms: Record<string, number> = {};
  const mark = (stage: string) => { timings_ms[stage] = Math.round(performance.now() - started); };
  if (inst.width !== 854 || inst.height !== 480) {
    throw new Error("add_server currently requires an 854×480 client; launch with the default dimensions");
  }
  const { host, port } = serverTarget(address);
  const existing = await savedName(inst.dataDir, host, port);
  if (existing !== undefined) {
    mark("entry_verified");
    if (join) await connectToServer(inst, host, port, mark, !connectRequestedAtStartup);
    mark("total_ms");
    return { saved: true, already_exists: true, joining: join, prompt_confirmed: join, name: existing, host, port, timings_ms };
  }

  const addUri = externalServerUri(name, address);
  // On this build the deep link saves the entry while opening Servers. Older
  // builds may only open the tab, so verify persistence before skipping the form.
  await inst.socket.call("uri", { uri: addUri });
  mark("add_uri_sent");
  await waitForScreen(inst, serversTabReady, "Servers tab");
  mark("servers_tab_ready");
  const fromUri = await savedName(inst.dataDir, host, port);
  if (fromUri !== undefined) {
    if (fromUri !== name) throw new Error(`Minecraft saved server name ${JSON.stringify(fromUri)} instead of ${JSON.stringify(name)}`);
    mark("entry_verified");
    if (join) await connectToServer(inst, host, port, mark);
    mark("total_ms");
    return { saved: true, already_exists: false, method: "deep_link", joining: join, prompt_confirmed: join, name, host, port, timings_ms };
  }

  // Some builds open the Servers tab without saving the deep link. Complete the
  // form only after checking the saved entry to avoid a duplicate.
  await serverInput(inst, "", [200, 98]);
  mark("form_opened");
  await waitForScreen(inst, addServerFormReady, "Add Server form");
  mark("form_ready");
  await serverInput(inst, name, [300, 80]);
  mark("name_typed");
  await serverInput(inst, host, [300, 130]);
  mark("host_typed");
  if (port !== 19132) {
    await serverInput(inst, String(port), [300, 180], 5);
    mark("port_typed");
  }
  await serverInput(inst, "", [300, 220]);
  mark("save_clicked");

  for (let i = 0; i < 10; i++) {
    const stored = await savedName(inst.dataDir, host, port);
    if (stored !== undefined) {
      if (stored !== name) throw new Error(`Minecraft saved server name ${JSON.stringify(stored)} instead of ${JSON.stringify(name)}`);
      mark("entry_verified");
      if (join) await connectToServer(inst, host, port, mark);
      mark("total_ms");
      return { saved: true, already_exists: false, method: "form", joining: join, prompt_confirmed: join, name, host, port, timings_ms };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Minecraft did not save the server; inspect the current screen for a form error");
}

// The launch-time add URI can save while the game is still loading. Wait for
// the exact entry and a stable interactive screen before sending connect.
// If the URI opened an interactive screen without saving, let addServer use
// its form fallback instead of waiting for a save that will not happen.
export async function waitForStartupServer(inst: Instance, name: string, address: string) {
  if (inst.width !== 854 || inst.height !== 480) {
    throw new Error("startup server join currently requires an 854×480 client");
  }
  externalServerUri(name, address);
  const { host, port } = serverTarget(address);
  const deadline = Date.now() + 30_000;
  let seenReady = false;
  let readyWithoutSaveSince = 0;
  while (Date.now() < deadline) {
    const stored = await savedName(inst.dataDir, host, port);
    if (stored !== undefined && stored !== name) {
      throw new Error(`Minecraft saved server name ${JSON.stringify(stored)} instead of ${JSON.stringify(name)}`);
    }
    const shot = await inst.socket.call("screenshot", { width: 854 });
    const image = shot.png_base64 as string;
    const ready = serversTabReady(image) || mainMenuReady(image);
    if (ready) {
      if (seenReady && stored === name) return;
      seenReady = true;
      if (stored === undefined) {
        if (!readyWithoutSaveSince) readyWithoutSaveSince = Date.now();
        if (Date.now() - readyWithoutSaveSince > 1_500) return;
      }
    } else {
      seenReady = false;
      readyWithoutSaveSince = 0;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Minecraft did not save the startup server on a ready screen");
}

async function connectToServer(inst: Instance, host: string, port: number, mark: (stage: string) => void, dispatchUri = true) {
  // A launch that skipped wait_for_menu has not switched its first input from
  // keyboard/controller to mouse mode yet. Do this before the trust dialog opens.
  await inst.socket.call("mouse_pos", { x: Math.round(inst.width * 0.7), y: Math.round(inst.height * 0.83) });
  const uri = serverConnectUri(`${host}:${port}`);
  if (dispatchUri) {
    await inst.socket.call("uri", { uri });
    mark("connect_uri_sent");
  }
  const deadline = Date.now() + 30_000;
  let readySince = 0;
  while (Date.now() < deadline) {
    const shot = await inst.socket.call("screenshot", { width: 854 });
    const image = shot.png_base64 as string;
    if (externalServerPromptReady(image)) {
      mark("prompt_ready");
      await serverInput(inst, "", [425, 265]);
      mark("continue_clicked");
      await new Promise((r) => setTimeout(r, 350));
      let followup = await inst.socket.call("screenshot", { width: 854 });
      if (externalServerPromptPresent(followup.png_base64 as string)) {
        await nativeInput(inst.id, "", ["Return"], undefined, 0, 20);
        await new Promise((r) => setTimeout(r, 350));
        followup = await inst.socket.call("screenshot", { width: 854 });
        if (externalServerPromptPresent(followup.png_base64 as string)) {
          throw new Error("Minecraft did not dismiss the external-server confirmation");
        }
      }
      mark("prompt_dismissed");
      return;
    }
    // A startup intent can be silently ignored by some builds. Once the main
    // menu has stayed interactive for five seconds without its prompt, retry
    // exactly once through the live socket.
    if (!dispatchUri) {
      if (mainMenuReady(image)) {
        if (!readySince) readySince = Date.now();
        if (Date.now() - readySince > 5_000) {
          await inst.socket.call("uri", { uri });
          mark("connect_uri_retried");
          dispatchUri = true;
        }
      } else {
        readySince = 0;
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Minecraft did not show the external-server confirmation; inspect the current screen");
}
