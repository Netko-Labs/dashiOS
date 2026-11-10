import { describe, expect, test } from "bun:test";
import {
  applyEvent,
  type ExtraStep,
  type ExtrasEvent,
  endOfRun,
  failedSteps,
  isOffline,
  LineSplitter,
  parseEvent,
  type StepStates,
  waitingStates,
} from "../src/setup/extras/events.ts";
import { hasNvidiaGpu } from "../src/setup/extras/hardware.ts";
import type { HelperRun, RunHelper } from "../src/setup/extras/helper.ts";
import { appsFor, defaultChoices, type ExtrasHardware, stepsFor } from "../src/setup/extras/plan.ts";
import { type AppInstaller, ExtrasStore } from "../src/setup/extras/store.ts";
import { installingContinueLabel, OFFLINE_NOTICE, runNotice, runSummary, stepLine } from "../src/setup/extras/words.ts";
import { Flow, type Machine, pagesFor } from "../src/setup/flow.ts";
import type { InstalledApp } from "../src/shared/software/flatpak-parse.ts";
import type { OnProgress, Outcome } from "../src/shared/software/manager.ts";
import { RECOMMENDED_APPS } from "../src/shared/software/recommended.ts";

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

describe("plan", () => {
  const plain: ExtrasHardware = { nvidia: false, nvidiaInstalled: false, gamingInstalled: false };

  test("codecs and Flathub on at first; NVIDIA only with a card that lacks the driver; gaming off", () => {
    expect(stepsFor(defaultChoices(plain), plain)).toEqual(["codecs", "flathub"]);
    const nvidia = { ...plain, nvidia: true };
    expect(stepsFor(defaultChoices(nvidia), nvidia)).toEqual(["codecs", "nvidia", "flathub"]);
    const installed = { ...nvidia, nvidiaInstalled: true };
    expect(stepsFor({ ...defaultChoices(installed), nvidia: true }, installed)).toEqual(["codecs", "flathub"]);
  });

  test("steps run in the helper's order, and what is installed is not asked again", () => {
    const all = { codecs: true, nvidia: true, gaming: true, flathub: true, apps: new Set<string>() };
    expect(stepsFor(all, { nvidia: true, nvidiaInstalled: false, gamingInstalled: false })).toEqual(["codecs", "nvidia", "gaming", "flathub"]);
    expect(stepsFor(all, { nvidia: false, nvidiaInstalled: false, gamingInstalled: true })).toEqual(["codecs", "flathub"]);
  });

  test("apps come in the list's order, and only with Flathub on", () => {
    const choices = { ...defaultChoices(plain), apps: new Set(["com.usebottles.bottles", "org.videolan.VLC"]) };
    expect(appsFor(choices).map((app) => app.id)).toEqual(["org.videolan.VLC", "com.usebottles.bottles"]);
    expect(appsFor({ ...choices, flathub: false })).toEqual([]);
  });

  test("the recommended list has valid, unique ids and no browser", () => {
    const ids = RECOMMENDED_APPS.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("com.heroicgameslauncher.hgl");
    expect(ids.some((id) => /firefox|chrom|brave|helium/i.test(id))).toBe(false);
  });
});

describe("hasNvidiaGpu", () => {
  test("an NVIDIA display controller, not NVIDIA's audio or USB functions", () => {
    expect(hasNvidiaGpu([{ vendor: "0x10de\n", class: "0x030000\n" }])).toBe(true);
    expect(hasNvidiaGpu([{ vendor: "0x10de", class: "0x030200" }])).toBe(true);
    expect(hasNvidiaGpu([{ vendor: "0x10de", class: "0x040300" }])).toBe(false);
    expect(hasNvidiaGpu([{ vendor: "0x1002", class: "0x030000" }])).toBe(false);
    expect(hasNvidiaGpu([])).toBe(false);
  });
});

describe("flow", () => {
  const machine: Machine = { wifi: false, wired: true, extras: true };

  test("Extras applies on an installed system; Installing only once a run starts", () => {
    expect(pagesFor(machine)).toEqual(["welcome", "language", "keyboard", "timezone", "appearance", "agents", "extras", "done"]);
    expect(pagesFor(machine, true)).toContain("installing");
    expect(pagesFor({ ...machine, extras: false }, true)).not.toContain("extras");
    expect(pagesFor({ ...machine, extras: false }, true)).not.toContain("installing");
  });

  test("Continue from Extras goes to Installing when installing, else to Done", () => {
    const flow = new Flow(machine, "extras");
    flow.next();
    expect(flow.getSnapshot().page).toBe("done");
    flow.back();
    flow.setInstalling(true);
    flow.next();
    expect(flow.getSnapshot().page).toBe("installing");
    // An agent cannot open the Installing page before a run.
    const fresh = new Flow(machine);
    fresh.goto("installing");
    expect(fresh.getSnapshot().page).toBe("welcome");
  });
});

/** A helper that plays back `events` (or ends with `code` having said nothing). */
function fakeHelper(script: (steps: readonly ExtraStep[]) => { events: ExtrasEvent[]; code: number }): RunHelper & { calls: ExtraStep[][] } {
  const calls: ExtraStep[][] = [];
  const run = async (steps: readonly ExtraStep[], onEvent: (event: ExtrasEvent) => void): Promise<HelperRun> => {
    calls.push([...steps]);
    const { events, code } = script(steps);
    for (const event of events) onEvent(event);
    return { code, sawEvents: events.length > 0 };
  };
  return Object.assign(run, { calls });
}

const succeed = (steps: readonly ExtraStep[]) => ({
  events: [
    ...steps.flatMap((step): ExtrasEvent[] => [
      { event: "start", step },
      { event: "done", step, message: null },
    ]),
    { event: "finished", ok: true } as const,
  ],
  code: 0,
});

function fakeSoftware(failing: ReadonlySet<string> = new Set(), installed: readonly string[] = []): AppInstaller & { installs: string[] } {
  const installs: string[] = [];
  return {
    installs,
    hasFlatpak: true,
    installed: async () => installed.map((id) => ({ id }) as InstalledApp),
    install: async (id: string, onProgress: OnProgress): Promise<Outcome> => {
      installs.push(id);
      onProgress({ fraction: 0.5, label: "Installing" });
      return failing.has(id) ? { ok: false, message: "No space left on device" } : { ok: true, message: "" };
    },
  };
}

const hardware = async (): Promise<ExtrasHardware> => ({ nvidia: false, nvidiaInstalled: false, gamingInstalled: false });

describe("ExtrasStore", () => {
  test("runs the helper's steps, then installs the ticked apps", async () => {
    const helper = fakeHelper(succeed);
    const software = fakeSoftware(new Set(), ["org.libreoffice.LibreOffice"]);
    const store = new ExtrasStore({ detect: hardware, runHelper: helper, software });
    await store.detect();
    await store.start();
    const { run } = store.getSnapshot();
    expect(helper.calls).toEqual([["codecs", "flathub"]]);
    expect(software.installs).toEqual(["org.videolan.VLC"]);
    expect(run.phase).toBe("finished");
    expect(run.apps.map((row) => row.state)).toEqual([
      { status: "done", message: null },
      { status: "done", message: "Already installed" },
    ]);
    expect(runNotice(run)).toEqual({ message: "Everything is installed.", action: null });
    expect(installingContinueLabel(run)).toBe("Continue");
    expect(runSummary(run)).toBe("Installed");
  });

  test("a dismissed password sheet installs nothing, and Try again asks again", async () => {
    let dismiss = true;
    const helper = fakeHelper((steps) => (dismiss ? { events: [], code: 126 } : succeed(steps)));
    const software = fakeSoftware();
    const store = new ExtrasStore({ detect: hardware, runHelper: helper, software });
    await store.detect();
    await store.start();
    expect(store.getSnapshot().run.phase).toBe("cancelled");
    expect(store.getSnapshot().run.states.codecs).toEqual({ status: "waiting" });
    expect(software.installs).toEqual([]);
    expect(runNotice(store.getSnapshot().run)?.action).toBe("try-again");
    expect(installingContinueLabel(store.getSnapshot().run)).toBe("Not now");
    dismiss = false;
    await store.retry();
    expect(store.getSnapshot().run.phase).toBe("finished");
    expect(software.installs).toEqual(["org.videolan.VLC", "org.libreoffice.LibreOffice"]);
  });

  test("offline: every step fails as offline, the apps are not tried, and the notice says to connect", async () => {
    const helper = fakeHelper((steps) => ({
      events: [
        ...steps.flatMap((step): ExtrasEvent[] => [
          { event: "start", step },
          { event: "failed", step, reason: "offline", message: "This computer is not connected to the internet." },
        ]),
        { event: "finished", ok: false },
      ],
      code: 1,
    }));
    const software = fakeSoftware();
    const store = new ExtrasStore({ detect: hardware, runHelper: helper, software });
    await store.start();
    const { run } = store.getSnapshot();
    expect(software.installs).toEqual([]);
    expect(run.apps.every((row) => row.state.status === "skipped")).toBe(true);
    expect(runNotice(run)).toEqual({ message: OFFLINE_NOTICE, action: "try-again" });
    expect(stepLine(run.states.codecs)).toBe("Not connected to the internet");
  });

  test("Retry runs only the failed step and the apps that did not install", async () => {
    let failGaming = true;
    const helper = fakeHelper((steps) => ({
      events: [
        ...steps.flatMap((step): ExtrasEvent[] =>
          step === "gaming" && failGaming
            ? [
                { event: "start", step },
                { event: "failed", step, reason: "package", message: "nothing provides steam" },
              ]
            : [
                { event: "start", step },
                { event: "done", step, message: null },
              ],
        ),
        { event: "finished", ok: !failGaming },
      ],
      code: failGaming ? 1 : 0,
    }));
    const software = fakeSoftware(new Set(["org.videolan.VLC"]));
    const store = new ExtrasStore({ detect: hardware, runHelper: helper, software });
    await store.detect();
    store.choose({ gaming: true });
    await store.start();
    let { run } = store.getSnapshot();
    expect(run.states.gaming).toEqual({ status: "failed", reason: "package", message: "nothing provides steam" });
    expect(stepLine(run.states.gaming)).toBe("nothing provides steam");
    expect(runNotice(run)?.action).toBe("retry");
    expect(runSummary(run)).toBe("Some not installed");
    failGaming = false;
    software.installs.length = 0;
    await store.retry();
    run = store.getSnapshot().run;
    expect(helper.calls).toEqual([["codecs", "gaming", "flathub"], ["gaming"]]);
    expect(software.installs).toEqual(["org.videolan.VLC"]);
    expect(run.states.gaming).toEqual({ status: "done", message: null });
    expect(run.states.codecs).toEqual({ status: "done", message: null });
  });

  test("nothing chosen is no work; a second start while one runs does nothing", async () => {
    let release: () => void = () => {};
    const helper = fakeHelper(succeed);
    const slow: RunHelper = (steps, onEvent) => new Promise((resolve) => (release = () => void helper(steps, onEvent).then(resolve)));
    const store = new ExtrasStore({ detect: hardware, runHelper: slow, software: fakeSoftware() });
    await store.detect();
    store.choose({ codecs: false, flathub: false });
    expect(store.hasWork()).toBe(false);
    store.choose({ codecs: true });
    const first = store.start();
    expect(store.running).toBe(true);
    await store.start();
    release();
    await first;
    expect(helper.calls).toEqual([["codecs"]]);
  });
});
