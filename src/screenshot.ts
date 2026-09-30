import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { AgentResponse } from "./socket.ts";

interface ScreenshotSource {
  socket: { call(cmd: string, args?: Record<string, unknown>): Promise<AgentResponse> };
  shotScale: number;
}

interface ScreenshotOptions {
  width?: number;
  save_path?: string;
  include_image?: boolean;
}

export async function screenshot(inst: ScreenshotSource, options: ScreenshotOptions = {}) {
  const { width, save_path, include_image = true } = options;
  if (save_path !== undefined && !isAbsolute(save_path)) throw new Error("save_path must be an absolute path on the MCP host");
  if (!include_image && !save_path) throw new Error("include_image: false requires save_path");

  const res = await inst.socket.call("screenshot", width ? { width } : {});
  inst.shotScale = (res.source_width as number) / (res.width as number);
  if (save_path) {
    await mkdir(dirname(save_path), { recursive: true });
    await writeFile(save_path, Buffer.from(res.png_base64 as string, "base64"));
  }
  return { content: [
    ...(include_image ? [{ type: "image" as const, data: res.png_base64 as string, mimeType: "image/png" }] : []),
    { type: "text" as const, text: `${res.width}x${res.height} (click coordinates are in this image's pixels)${save_path ? `\nSaved PNG: ${save_path}` : ""}` },
  ] };
}
