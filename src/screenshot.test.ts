import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { screenshot } from "./screenshot.ts";

const png = PNG.sync.write(new PNG({ width: 2, height: 1 }));
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "minecraft-screenshot-"));
  directories.push(path);
  return path;
}

function source() {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  return {
    calls,
    shotScale: 1,
    socket: { async call(cmd: string, args?: Record<string, unknown>) {
      calls.push({ cmd, args });
      return { ok: true, width: 426, height: 240, source_width: 854, png_base64: png.toString("base64") };
    } },
  };
}

test("default screenshot keeps the inline image and updates click scaling", async () => {
  const inst = source();
  const result = await screenshot(inst, { width: 426 });
  expect(inst.calls).toEqual([{ cmd: "screenshot", args: { width: 426 } }]);
  expect(inst.shotScale).toBe(854 / 426);
  expect(result.content).toEqual([
    { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    { type: "text", text: "426x240 (click coordinates are in this image's pixels)" },
  ]);
});

test("path-only handoff saves the captured PNG without returning image data", async () => {
  const path = join(await directory(), "nested", "frame.png");
  const result = await screenshot(source(), { save_path: path, include_image: false });
  expect((await readFile(path)).equals(png)).toBe(true);
  expect(PNG.sync.read(await readFile(path)).width).toBe(2);
  expect(result.content).toEqual([{ type: "text", text: `426x240 (click coordinates are in this image's pixels)\nSaved PNG: ${path}` }]);
});

test("saved evidence can also return the inline image", async () => {
  const path = join(await directory(), "frame.png");
  await writeFile(path, "old screenshot");
  const result = await screenshot(source(), { save_path: path });
  expect((await readFile(path)).equals(png)).toBe(true);
  expect(result.content[0]?.type).toBe("image");
});

test.each([
  [{ include_image: false }, "requires save_path"],
  [{ save_path: "relative/frame.png" }, "absolute path"],
])("invalid handoff options fail before capturing", async (options, message) => {
  const inst = source();
  await expect(screenshot(inst, options)).rejects.toThrow(message);
  expect(inst.calls).toEqual([]);
});

test("a failed save reports an error instead of a nonexistent handoff", async () => {
  const path = await directory();
  await expect(screenshot(source(), { save_path: path, include_image: false })).rejects.toThrow();
});
