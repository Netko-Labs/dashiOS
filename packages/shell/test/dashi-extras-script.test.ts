/** session/dashi-extras in --dry-run, read through the shell's own parser: the contract both sides keep. */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type ExtrasEvent, parseEvent } from "../src/setup/extras/events.ts";
import { helperCommand } from "../src/setup/extras/helper.ts";

const SCRIPT = join(import.meta.dir, "../../../session/dashi-extras");

async function dryRun(args: string[], env: Record<string, string> = {}): Promise<{ code: number; lines: string[]; events: (ExtrasEvent | null)[] }> {
  const child = Bun.spawn([SCRIPT, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    env: { PATH: "/usr/bin:/bin", DASHI_EXTRAS_NETWORK: "online", DASHI_EXTRAS_NVIDIA: "0", ...env },
  });
  const out = await new Response(child.stdout).text();
  const lines = out.split("\n").filter((line) => line !== "");
  return { code: await child.exited, lines, events: lines.map(parseEvent) };
}

describe("dashi-extras --dry-run", () => {
  test("every line is an event; steps run in order; finished comes last", async () => {
    const { code, events } = await dryRun(["--dry-run", "codecs", "nvidia", "gaming", "flathub"]);
    expect(code).toBe(0);
    expect(events.every((event) => event !== null)).toBe(true);
    const starts = events.flatMap((event) => (event?.event === "start" ? [event.step] : []));
    expect(starts).toEqual(["codecs", "nvidia", "gaming", "flathub"]);
    expect(events.at(-1)).toEqual({ event: "finished", ok: true });
    expect(events).toContainEqual({ event: "done", step: "nvidia", message: "There is no NVIDIA graphics card in this computer." });
    for (const event of events) if (event?.event === "progress" && event.fraction !== null) expect(event.fraction).toBeGreaterThanOrEqual(0);
  });

  test("a failed step does not stop the others, and the exit status is 1", async () => {
    const { code, events } = await dryRun(["--dry-run", "codecs", "gaming", "flathub"], { DASHI_EXTRAS_FAIL: "codecs" });
    expect(code).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ event: "failed", step: "codecs", reason: "package" }));
    expect(events).toContainEqual({ event: "done", step: "flathub", message: null });
    expect(events.at(-1)).toEqual({ event: "finished", ok: false });
  });

  test("offline: every step fails as offline", async () => {
    const { code, events } = await dryRun(["--dry-run", "codecs", "flathub"], { DASHI_EXTRAS_NETWORK: "offline" });
    expect(code).toBe(1);
    const failed = events.filter((event) => event?.event === "failed");
    expect(failed.map((event) => event?.event === "failed" && [event.step, event.reason])).toEqual([
      ["codecs", "offline"],
      ["flathub", "offline"],
    ]);
  });

  test("a usage error prints no events and exits 2", async () => {
    for (const args of [[], ["--dry-run"], ["--dry-run", "kernel"], ["--now", "codecs"]]) {
      const { code, lines } = await dryRun(args);
      expect(code).toBe(2);
      expect(lines).toEqual([]);
    }
  });

  test("a step named twice runs once", async () => {
    const { events } = await dryRun(["--dry-run", "flathub", "flathub"]);
    expect(events.filter((event) => event?.event === "start")).toHaveLength(1);
  });

  test("without --dry-run and without root it changes nothing and says why", async () => {
    if (process.getuid?.() === 0) return;
    const { code, events } = await dryRun(["flathub"]);
    expect(code).toBe(1);
    expect(events[1]).toMatchObject({ event: "failed", step: "flathub", reason: "other" });
  });
});

describe("helperCommand", () => {
  const exists = (path: string): boolean => path === "/usr/libexec/dashi/dashi-extras";

  test("pkexec and the installed helper, with the steps as arguments", () => {
    expect(helperCommand(["codecs", "gaming"], false, exists, () => "/usr/bin/pkexec")).toEqual([
      "/usr/bin/pkexec",
      "/usr/libexec/dashi/dashi-extras",
      "codecs",
      "gaming",
    ]);
  });

  test("none without pkexec or the helper", () => {
    expect(helperCommand(["codecs"], false, exists, () => null)).toBeNull();
    expect(
      helperCommand(
        ["codecs"],
        false,
        () => false,
        () => "/usr/bin/pkexec",
      ),
    ).toBeNull();
  });

  test("a dry run never goes through pkexec", () => {
    const command = helperCommand(["flathub"], true, exists, () => "/usr/bin/pkexec");
    expect(command?.[0]).not.toContain("pkexec");
    expect(command?.slice(1)).toEqual(["--dry-run", "flathub"]);
  });
});
