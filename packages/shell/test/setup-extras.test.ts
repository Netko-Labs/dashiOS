import { describe, expect, test } from "bun:test";
import {
  applyEvent,
  type ExtraStep,
  type ExtrasEvent,
  endOfRun,
  failedSteps,
  isOffline,
  parseEvent,
  type StepStates,
  waitingStates,
} from "../src/setup/lib/extras/events.ts";
import { LineSplitter } from "../src/shared/io/lines.ts";

describe("parseEvent", () => {
  test("reads every event the helper sends", () => {
    expect(parseEvent('{"event":"start","step":"codecs"}')).toEqual({ event: "start", step: "codecs" });
    expect(parseEvent('{"event":"progress","step":"gaming","message":"Installing Steam","fraction":0.4}')).toEqual({
      event: "progress",
      step: "gaming",
      message: "Installing Steam",
      fraction: 0.4,
    });
    expect(parseEvent('{"event":"done","step":"nvidia","message":"There is no NVIDIA graphics card in this computer."}')).toEqual({
      event: "done",
      step: "nvidia",
      message: "There is no NVIDIA graphics card in this computer.",
    });
    expect(parseEvent('{"event":"done","step":"flathub"}')).toEqual({ event: "done", step: "flathub", message: null });
    expect(parseEvent('{"event":"failed","step":"codecs","reason":"offline","message":"No network"}')).toEqual({
      event: "failed",
      step: "codecs",
      reason: "offline",
      message: "No network",
    });
    expect(parseEvent('{"event":"finished","ok":false}')).toEqual({ event: "finished", ok: false });
  });

  test("a progress without a fraction is busy, and a fraction out of range is clamped", () => {
    expect(parseEvent('{"event":"progress","step":"codecs","message":"Working"}')).toMatchObject({ fraction: null });
    expect(parseEvent('{"event":"progress","step":"codecs","message":"Working","fraction":3}')).toMatchObject({ fraction: 1 });
    expect(parseEvent('{"event":"progress","step":"codecs","message":"Working","fraction":"half"}')).toMatchObject({ fraction: null });
  });

  test("drops what is not an event", () => {
    for (const line of [
      "",
      "Last metadata expiration check: 0:01:02 ago",
      "[]",
      "null",
      '{"event":"start"}',
      '{"event":"start","step":"kernel"}',
      '{"event":"failed","step":"codecs","reason":"cosmic rays","message":"x"}',
      '{"event":"progress","step":"codecs"}',
      '{"event":"finished","ok":"yes"}',
      '{"event":"restart","step":"codecs"}',
    ]) {
      expect(parseEvent(line)).toBeNull();
    }
  });

  test("a failure without words still says something, and long words are cut", () => {
    expect(parseEvent('{"event":"failed","step":"gaming","reason":"package","message":""}')).toMatchObject({ message: "It did not finish." });
    const long = parseEvent(JSON.stringify({ event: "progress", step: "codecs", message: "x".repeat(1000) }));
    expect(long?.event === "progress" && long.message.length).toBe(300);
  });
});

describe("LineSplitter", () => {
  test("joins lines split across chunks and skips blank ones", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"event":"start",')).toEqual([]);
    expect(splitter.push('"step":"codecs"}\n\n{"event":"done"')).toEqual(['{"event":"start","step":"codecs"}']);
    expect(splitter.push(',"step":"codecs"}\n')).toEqual(['{"event":"done","step":"codecs"}']);
    expect(splitter.push('{"event":"finished","ok":true}')).toEqual([]);
    expect(splitter.end()).toEqual(['{"event":"finished","ok":true}']);
    expect(splitter.end()).toEqual([]);
  });
});

describe("step states", () => {
  const run = (steps: ExtraStep[], events: ExtrasEvent[]): StepStates => events.reduce(applyEvent, waitingStates(steps));

  test("a step goes from waiting to running to done", () => {
    const states = run(
      ["codecs", "flathub"],
      [
        { event: "start", step: "codecs" },
        { event: "progress", step: "codecs", message: "Enabling RPM Fusion", fraction: 0.1 },
      ],
    );
    expect(states.codecs).toEqual({ status: "running", message: "Enabling RPM Fusion", fraction: 0.1 });
    expect(states.flathub).toEqual({ status: "waiting" });
    const done = applyEvent(states, { event: "done", step: "codecs", message: null });
    expect(done.codecs).toEqual({ status: "done", message: null });
  });

  test("events for steps not asked for, or after a step ended, change nothing", () => {
    const states = run(
      ["codecs"],
      [
        { event: "start", step: "gaming" },
        { event: "start", step: "codecs" },
        { event: "failed", step: "codecs", reason: "package", message: "No match for ffmpeg" },
        { event: "progress", step: "codecs", message: "late", fraction: 0.9 },
        { event: "done", step: "codecs", message: null },
      ],
    );
    expect(states).toEqual({ codecs: { status: "failed", reason: "package", message: "No match for ffmpeg" } });
  });

  test("a run that stopped early fails the steps it left behind", () => {
    const states = run(["codecs", "gaming"], [{ event: "start", step: "codecs" }]);
    const end = endOfRun(states, 1, true);
    expect(end.kind).toBe("ran");
    if (end.kind !== "ran") return;
    expect(end.states.codecs).toMatchObject({ status: "failed", reason: "other", message: "The installer stopped before it finished." });
    expect(end.states.gaming).toMatchObject({ status: "failed", reason: "other" });
  });

  test("pkexec running nothing is a cancel (126) or a refusal (127)", () => {
    const states = waitingStates(["codecs"]);
    expect(endOfRun(states, 126, false)).toEqual({ kind: "cancelled" });
    expect(endOfRun(states, 127, false)).toEqual({ kind: "denied" });
    // The helper itself can exit 1 with events: that is a run, not a refusal.
    expect(endOfRun(applyEvent(states, { event: "failed", step: "codecs", reason: "package", message: "x" }), 1, true).kind).toBe("ran");
    // It could not start at all.
    expect(endOfRun(states, null, false)).toMatchObject({ kind: "ran", states: { codecs: { message: "The installer could not start." } } });
  });

  test("offline only when every failure is for want of a network", () => {
    const offline: StepStates = {
      codecs: { status: "failed", reason: "offline", message: "x" },
      flathub: { status: "failed", reason: "offline", message: "x" },
    };
    expect(isOffline(offline)).toBe(true);
    expect(isOffline({ ...offline, flathub: { status: "failed", reason: "package", message: "x" } })).toBe(false);
    expect(isOffline({ codecs: { status: "done", message: null } })).toBe(false);
    expect(failedSteps(["flathub", "codecs", "gaming"], offline)).toEqual(["flathub", "codecs"]);
  });
});
