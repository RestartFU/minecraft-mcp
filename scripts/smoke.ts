// One bounded live MCP check. The disposable saved server is removed after the client stops.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync } from "node:fs";

const client = new Client({ name: "minecraft-mcp-smoke", version: "1.0.0" });
const id = `smoke_${process.pid}`;
const host = `mcp-smoke-${process.pid}.invalid`;
const serverFile = `${process.env.MCPELAUNCHER_DATA}/games/com.mojang/minecraftpe/external_servers.txt`;
let launched = false;
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const detail = result.content.find((part) => part.type === "text");
  if (result.isError) throw new Error(`${name}: ${detail?.text}`);
  return detail?.text ? JSON.parse(detail.text) : {};
};
try {
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: ["run", new URL("../src/index.ts", import.meta.url).pathname],
    env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)) }));
  const preflight = await call("preflight");
  if (!preflight.ok) throw new Error(`preflight: ${preflight.issues.join("; ")}`);
  const started = performance.now();
  const launch = await call("launch", { id, wait_for_menu: true });
  launched = true;
  console.log(JSON.stringify({ stage: "launch", ms: Math.round(performance.now() - started), pid: launch.pid }));
  const addStarted = performance.now();
  const added = await call("add_server", { instance: id, name: `MCP Smoke ${process.pid}`,
    address: `${host}:19133` });
  if (!added.saved || added.already_exists) throw new Error("new server was not saved");
  console.log(JSON.stringify({ stage: "add_server", ms: Math.round(performance.now() - addStarted), added }));
  const state = await call("state", { instance: id });
  console.log(JSON.stringify({ stage: "state", fps_cap: state.fps_cap }));
} finally {
  if (launched) await call("stop", { instance: id });
  await client.close();
  const content = readFileSync(serverFile, "utf8");
  const lines = content.split(/(?<=\n)/);
  const removed = lines.filter((line) => line.includes(`:${host}:19133:`));
  if (removed.length === 1) writeFileSync(serverFile, lines.filter((line) => !removed.includes(line)).join(""));
  if (removed.length > 1) throw new Error(`found ${removed.length} disposable saved server entries`);
}
