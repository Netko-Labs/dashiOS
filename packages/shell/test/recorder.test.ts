import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODECS, recorderArgs, recordingName, WF_RECORDER } from "../src/recorder/command.ts";
import { type RecorderProcess, ScreenRecorder } from "../src/recorder/recorder.ts";
import { stopsRecording } from "../src/recorder/start.ts";
import { elapsedText } from "../src/shared/time/elapsed.ts";
import { flush } from "./support/time.ts";

describe("recordingName", () => {
  test("the Mac's name, a copy number for one taken", () => {
    const when = new Date(2026, 10, 3, 21, 4, 5);
    expect(recordingName(when, "mp4", () => false)).toBe("Screen Recording 2026-11-03 at 21.04.05.mp4");
    const taken = new Set(["Screen Recording 2026-11-03 at 21.04.05.mp4"]);
    expect(recordingName(when, "mp4", (name) => taken.has(name))).toBe("Screen Recording 2026-11-03 at 21.04.05 (2).mp4");
  });
});

describe("recorderArgs", () => {
  const codec = CODECS[0] as (typeof CODECS)[number];
  test("a screen by name, shm buffers, the codec's options", () => {
    const args = recorderArgs({ target: { kind: "screen", output: "eDP-1" }, file: "/v/a.mp4", codec, microphone: false });
    expect(args.slice(0, 6)).toEqual(["-o", "eDP-1", "-f", "/v/a.mp4", "-c", "libx264"]);
    expect(args).toContain("--no-dmabuf");
    expect(args).toContain("preset=veryfast");
    expect(args).not.toContain("-a");
  });

  test("an area as wf-recorder's geometry, rounded; the microphone through PipeWire", () => {
    const args = recorderArgs({ target: { kind: "area", x: 10.4, y: 20, width: 300.6, height: 1 }, file: "/v/a.mp4", codec, microphone: true });
    expect(args.slice(0, 2)).toEqual(["-g", "10,20 301x2"]);
    expect(args).toContain("-a");
    expect(args).toContain("--audio-backend=pipewire");
  });
});

describe("elapsedText", () => {
  test("minutes and seconds, hours when there are some", () => {
    expect(elapsedText(7_400)).toBe("0:07");
    expect(elapsedText(754_000)).toBe("12:34");
    expect(elapsedText(3_723_000)).toBe("1:02:03");
    expect(elapsedText(-5)).toBe("0:00");
  });
});

/** A wf-recorder that exits when told to, or at once with `failsWith`. */
function fakeProcess(failsWith?: number): RecorderProcess & { signals: string[] } {
  let exit: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    exit = resolve;
  });
  if (failsWith !== undefined) exit(failsWith);
  const signals: string[] = [];
  const kill = (signal: string): void => {
    signals.push(signal);
    exit(0);
  };
  return { exited, signals, kill };
}

describe("ScreenRecorder", () => {
  const videos = mkdtempSync(join(tmpdir(), "dashi-recorder-"));
  test("allows wf-recorder while it records, falls back to the next codec, and saves on stop", async () => {
    const spawned: string[][] = [];
    const processes = [fakeProcess(1), fakeProcess()];
    const allowed: string[] = [];
    const saved: string[] = [];
    let files = new Set<string>();
    const recorder = new ScreenRecorder({
      allow: (path) => {
        allowed.push(path);
        return () => allowed.splice(allowed.indexOf(path), 1);
      },
      spawn: (argv) => {
        spawned.push(argv);
        const file = argv[argv.indexOf("-f") + 1] as string;
        files = new Set([...files, file]);
        return processes.shift() as RecorderProcess;
      },
      exists: (path) => path === WF_RECORDER || files.has(path),
      directory: () => videos,
      saved: (file) => saved.push(file),
    });
    const file = await recorder.start({ kind: "screen", output: "Virtual-1" });
    expect(spawned.map((argv) => argv[argv.indexOf("-c") + 1])).toEqual(["libx264", "libopenh264"]);
    expect(file.startsWith(join(videos, "Screen Recording "))).toBe(true);
    expect(recorder.getSnapshot().kind).toBe("recording");
    expect(allowed).toEqual([WF_RECORDER]);
    expect(await recorder.stop()).toBe(file);
    await flush();
    expect(recorder.getSnapshot().kind).toBe("idle");
    expect(allowed).toEqual([]);
    expect(saved).toEqual([file]);
    // The compositor's capture tail is still the recorder's for a moment.
    expect(recorder.ownsCapture()).toBe(true);
    expect(recorder.ownsCapture(Date.now() + 5000)).toBe(false);
  });

  test("an agent's recording waits until its blanks are set, and doesn't start without them", async () => {
    const order: string[] = [];
    const gated = (): RecorderProcess => ({ ...fakeProcess(), pid: 4242, go: () => order.push("go") });
    const recorder = (process: RecorderProcess) =>
      new ScreenRecorder({
        allow: () => () => {},
        spawn: (_argv, isGated) => {
          order.push(`spawn gated=${isGated}`);
          return process;
        },
        exists: (path) => path === WF_RECORDER,
        directory: () => videos,
      });
    const one = recorder(gated());
    await one.start({ kind: "screen", output: "Virtual-1" }, { beforeCapture: async (pid) => void order.push(`mask ${pid}`) });
    expect(order).toEqual(["spawn gated=true", "mask 4242", "go"]);
    await one.stop();
    order.length = 0;
    const refused = recorder(gated());
    await expect(
      refused.start(
        { kind: "screen", output: "Virtual-1" },
        {
          beforeCapture: async () => {
            throw new Error("no compositor");
          },
        },
      ),
    ).rejects.toThrow("couldn't blank");
    expect(order).not.toContain("go");
    expect(refused.getSnapshot().kind).toBe("idle");
  });

  test("⇧❖5 stops only the person's own recording; an agent's runs on and the toolbar opens", async () => {
    const recorder = new ScreenRecorder({ allow: () => () => {}, spawn: () => fakeProcess(), exists: (path) => path === WF_RECORDER, directory: () => videos });
    await recorder.start({ kind: "screen", output: "Virtual-1" }, { by: "agent" });
    expect(stopsRecording(recorder.getSnapshot())).toBe(false);
    await recorder.stop();
    await recorder.start({ kind: "screen", output: "Virtual-1" });
    expect(stopsRecording(recorder.getSnapshot())).toBe(true);
    await recorder.stop();
    expect(stopsRecording({ kind: "idle" })).toBe(false);
  });

  test("a recording's length is the recorder's own clock, from wf-recorder's start to its end", async () => {
    let clock = 1_000;
    const recorder = new ScreenRecorder({
      allow: () => () => {},
      spawn: () => fakeProcess(),
      exists: (path) => path === WF_RECORDER,
      directory: () => videos,
      now: () => clock,
    });
    const file = await recorder.start({ kind: "screen", output: "Virtual-1" }, { by: "agent" });
    clock += 6_400;
    await recorder.stop();
    expect(recorder.lengthOf(file)).toBe(6.4);
    expect(recorder.lengthOf("/elsewhere.mp4")).toBeNull();
    // record_screen says that, not the time it waited; without it, the wait.
    const { recordedLength } = await import("../src/agents/desktop/record.ts");
    expect(recordedLength(6.4, 0, 40_000)).toBe(6.4);
    expect(recordedLength(null, 0, 40_000)).toBe(40);
  });

  test("refuses without wf-recorder, and a second recording", async () => {
    const missing = new ScreenRecorder({ allow: () => () => {}, exists: () => false, directory: () => "/videos" });
    await expect(missing.start({ kind: "screen", output: "x" })).rejects.toThrow("wf-recorder");
  });
});

describe("record_screen's helpers", () => {
  test("stills sit in the middles of equal slices", async () => {
    const { stillTimes } = await import("../src/agents/desktop/record.ts");
    expect(stillTimes(6, 3)).toEqual([1000, 3000, 5000]);
    expect(stillTimes(5, 0)).toEqual([]);
  });

  test("the named screen, else the main display, else the first", async () => {
    const { displayOf } = await import("../src/agents/desktop/record.ts");
    const frame = { x: 0, y: 0, width: 1280, height: 800 };
    const answer = {
      outputs: [
        { name: "DP-1", frame: { ...frame, x: 1280 } },
        { name: "eDP-1", primary: true, frame },
        { name: "HDMI-A-1", enabled: false, frame },
      ],
    };
    expect(displayOf(answer, null)?.name).toBe("eDP-1");
    expect(displayOf(answer, "DP-1")?.frame.x).toBe(1280);
    expect(displayOf(answer, "HDMI-A-1")).toBeNull();
    expect(displayOf({ outputs: [{ name: "X", frame }] }, null)?.name).toBe("X");
    expect(displayOf(null, null)).toBeNull();
  });
});
