/**
 * The root scripts' option parsers, argument parsing only. A value option with
 * no value once looped forever (`shift 2` fails on the last argument and
 * shifts nothing); each must now stop at once with status 2 and name the
 * option. Nothing here is root, and nothing touches a disk: the parser stops
 * before the script does anything.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const TIMEOUT_MS = 5000;

const SCRIPTS: Record<string, { path: string; valueOptions: string[]; flags: string[] }> = {
  "dashi-install": {
    path: "spin/dashi-live/usr/libexec/dashi/dashi-install",
    valueOptions: ["--disk", "--user", "--full-name", "--hostname", "--nvidia", "--kernel", "--source"],
    flags: ["--dry-run"],
  },
  "finish-install": {
    path: "spin/dashi-live/usr/libexec/dashi/finish-install",
    valueOptions: ["--root", "--nvidia", "--kernel", "--graphics"],
    flags: [],
  },
  "default-kernel": {
    path: "spin/dashi-kernel/usr/libexec/dashi/default-kernel",
    valueOptions: ["--except"],
    flags: ["--dry-run", "--check"],
  },
};

async function run(script: string, args: string[]): Promise<{ code: number | null; stderr: string; timedOut: boolean }> {
  const child = Bun.spawn([join(ROOT, script), ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: "/usr/bin:/bin" },
    timeout: TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const [stderr, , code] = await Promise.all([new Response(child.stderr).text(), new Response(child.stdout).text(), child.exited]);
  return { code, stderr, timedOut: child.signalCode === "SIGKILL" };
}

for (const [name, { path, valueOptions, flags }] of Object.entries(SCRIPTS)) {
  describe(`${name}: an option with no value`, () => {
    for (const option of valueOptions) {
      test(`${option} last: exit 2 at once, naming the option`, async () => {
        const result = await run(path, [option]);
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain(option);
      });

      test(`${option} last, after a good option`, async () => {
        const result = await run(path, [...flags, option]);
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain(option);
      });
    }

    test("an unknown option is a usage error, not a loop", async () => {
      const result = await run(path, ["--no-such-option"]);
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(2);
    });
  });
}
