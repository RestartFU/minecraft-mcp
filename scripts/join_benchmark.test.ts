import { expect, test } from "bun:test";
import { parseOptions, withoutDisposableServer } from "./join_benchmark.ts";

test("combined mode names the verified Save, URI, and Continue route", () => {
  const args = ["--target", "127.0.0.1:19357", "--output", "/tmp/minecraft-join-test", "--mode", "combined"];
  expect(parseOptions(args).mode).toBe("combined");
  expect(parseOptions(args).cpuQuotaPercent).toBe(250);
  expect(() => parseOptions([...args.slice(0, -1), "add-and-play"])).toThrow("--mode must be saved, combined, or direct-uri");
});

test("disposable server cleanup preserves unrelated entries and line endings", () => {
  const original = "1:Other:127.0.0.1:19153:1\r\n2:Bench123:127.0.0.1:19153:2\r\n3:Bench123:example.test:19153:3\r\n";
  expect(withoutDisposableServer(original, "Bench123", "127.0.0.1", 19153)).toEqual({
    content: "1:Other:127.0.0.1:19153:1\r\n3:Bench123:example.test:19153:3\r\n",
    removed: 1,
  });
});

test("disposable server cleanup refuses ambiguous matches", () => {
  const original = "1:Bench123:127.0.0.1:19153:1\n2:Bench123:127.0.0.1:19153:2\n";
  expect(() => withoutDisposableServer(original, "Bench123", "127.0.0.1", 19153)).toThrow("Refusing to remove 2");
});
