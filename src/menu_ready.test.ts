import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { externalServerPromptReady, mainMenuReady, trustPromptReady } from "./menu_ready.ts";

// Frames captured from the 1.26.60.4 client at 854×480.
const frame = (name: string) => readFileSync(join(import.meta.dir, "testdata", name)).toString("base64");
const frames = {
  trust: frame("trust-prompt-26.60.png"),
  external: frame("external-server-prompt-26.60.png"),
  packs: frame("resource-pack-prompt-26.60.png"),
  menu: frame("main-menu-signing-in-26.60.png"),
};

test("trust prompt is told apart from the other join dialogs", () => {
  expect(trustPromptReady(frames.trust)).toBe(true);
  expect(trustPromptReady(frames.external)).toBe(false);
  expect(trustPromptReady(frames.packs)).toBe(false);
  expect(trustPromptReady(frames.menu)).toBe(false);
});

test("external-server prompt is not mistaken for the trust prompt", () => {
  expect(externalServerPromptReady(frames.external)).toBe(true);
  expect(externalServerPromptReady(frames.trust)).toBe(false);
  expect(externalServerPromptReady(frames.packs)).toBe(false);
});

test("main menu reads as ready while sign-in is still running", () => {
  // The menu renders before sign-in finishes; queued URIs wait for sign-in.
  expect(mainMenuReady(frames.menu)).toBe(true);
});
