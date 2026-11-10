/**
 * Every shell script under session/, spin/, vm/ and data/ parses and passes
 * shellcheck (any severity). A warning that is wrong is silenced in the script
 * with `# shellcheck disable=SCxxxx` and the reason. shellcheck is skipped,
 * with a note, where it isn't installed; the syntax check always runs.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");

function tracked(): string[] {
  const out = Bun.spawnSync(["git", "ls-files", "-z", "session", "spin", "vm", "data"], { cwd: ROOT }).stdout.toString();
  return out.split("\0").filter((path) => {
    if (path === "") return false;
    try {
      return /^#!\s*\S*(\/|\s)(ba|da|z)?sh\b/.test(readFileSync(join(ROOT, path), "utf8").split("\n", 1)[0] ?? "");
    } catch {
      return false;
    }
  });
}

const scripts = tracked();
const shellcheck = Bun.which("shellcheck");

describe("shell scripts", () => {
  test("the list is not empty", () => {
    expect(scripts.length).toBeGreaterThan(20);
  });

  for (const path of scripts) {
    const shebang = readFileSync(join(ROOT, path), "utf8").split("\n", 1)[0] ?? "";
    const shell = shebang.includes("bash") ? "bash" : "sh";

    test(`${path} parses (${shell} -n)`, () => {
      const result = Bun.spawnSync([shell, "-n", join(ROOT, path)]);
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
    });

    test.skipIf(!shellcheck)(`${path} passes shellcheck`, () => {
      const result = Bun.spawnSync([shellcheck as string, "--format=gcc", join(ROOT, path)]);
      expect(result.stdout.toString()).toBe("");
      expect(result.exitCode).toBe(0);
    });
  }
});
