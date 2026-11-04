import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODECS, recorderArgs, recordingName, WF_RECORDER } from "../src/recorder/command.ts";
import { elapsedText } from "../src/recorder/indicator.tsx";
import { type RecorderProcess, ScreenRecorder } from "../src/recorder/recorder.ts";

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
    await Bun.sleep(0);
    expect(recorder.getSnapshot().kind).toBe("idle");
    expect(allowed).toEqual([]);
    expect(saved).toEqual([file]);
    // The compositor's capture tail is still the recorder's for a moment.
    expect(recorder.ownsCapture()).toBe(true);
    expect(recorder.ownsCapture(Date.now() + 5000)).toBe(false);
  }, 5000);

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
