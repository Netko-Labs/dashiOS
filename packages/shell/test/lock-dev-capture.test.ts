/**
 * The VM's picture of the real lock screen: only with the variable, only in
 * a private folder, only while locked; and the installed session clears the
 * variable, so an installed Dashi never has the path.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { devCaptureFolder, lookForAsk } from "../src/lock/lib/dev-capture.ts";

const dirStat =
  (uid: number, mode: number, link = false) =>
  () => ({ isDirectory: () => !link, isSymbolicLink: () => link, uid, mode });

describe("the folder", () => {
  test("none without the variable", () => {
    expect(devCaptureFolder({}, dirStat(1000, 0o700), 1000)).toBeNull();
  });

  test("only an absolute, private directory of this user", () => {
    expect(devCaptureFolder({ DASHI_DEV_LOCK_CAPTURE: "/home/alexk/shots" }, dirStat(1000, 0o40700), 1000)).toEqual({ dir: "/home/alexk/shots" });
    expect(devCaptureFolder({ DASHI_DEV_LOCK_CAPTURE: "shots" }, dirStat(1000, 0o700), 1000)).toHaveProperty("refused");
    expect(devCaptureFolder({ DASHI_DEV_LOCK_CAPTURE: "/tmp/shots" }, dirStat(0, 0o700), 1000)).toEqual({ refused: "another user owns it" });
    expect(devCaptureFolder({ DASHI_DEV_LOCK_CAPTURE: "/tmp/shots" }, dirStat(1000, 0o755), 1000)).toEqual({ refused: "others may open it (it must be 0700)" });
    expect(devCaptureFolder({ DASHI_DEV_LOCK_CAPTURE: "/tmp/shots" }, dirStat(1000, 0o700, true), 1000)).toEqual({ refused: "it is not a directory" });
  });
});

describe("a look", () => {
  const deps = (locked: boolean, asked: boolean) => {
    const shots: Array<[string, string | undefined]> = [];
    const removed: string[] = [];
    return {
      shots,
      removed,
      deps: {
        locked: () => locked,
        capture: async (path: string, output?: string) => shots.push([path, output]),
        now: () => 7,
        exists: () => asked,
        remove: (path: string) => removed.push(path),
      },
    };
  };

  test("while locked, an ask becomes one picture and the ask goes", async () => {
    const run = deps(true, true);
    expect(await lookForAsk("/d", run.deps)).toBe("/d/lock-7.png");
    expect(run.shots).toEqual([["/d/lock-7.png", undefined]]);
    expect(run.removed).toEqual(["/d/ask"]);
  });

  test("`ask-<screen>` pictures that screen", async () => {
    const shots: Array<[string, string | undefined]> = [];
    const removed: string[] = [];
    const path = await lookForAsk("/d", {
      locked: () => true,
      capture: async (file, output) => shots.push([file, output]),
      screens: async () => ["eDP-1", "HDMI-A-1"],
      now: () => 7,
      exists: (file) => file === "/d/ask-HDMI-A-1",
      remove: (file) => removed.push(file),
    });
    expect(path).toBe("/d/lock-7-HDMI-A-1.png");
    expect(shots).toEqual([["/d/lock-7-HDMI-A-1.png", "HDMI-A-1"]]);
    expect(removed).toEqual(["/d/ask-HDMI-A-1"]);
  });

  test("unlocked, nothing is taken, the ask stays", async () => {
    const run = deps(false, true);
    expect(await lookForAsk("/d", run.deps)).toBeNull();
    expect(run.shots).toEqual([]);
    expect(run.removed).toEqual([]);
  });
});

test("the installed session clears the variable before it starts anything", () => {
  const script = readFileSync(join(import.meta.dir, "../../../session/dashi-session"), "utf8");
  const clear = script.indexOf('[ "$layout" = installed ] && unset DASHI_DEV_LOCK_CAPTURE');
  expect(clear).toBeGreaterThan(script.indexOf("layout=installed"));
  expect(clear).toBeLessThan(script.indexOf("exec "));
});
