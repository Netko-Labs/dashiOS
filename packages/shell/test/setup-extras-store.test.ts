import { describe, expect, test } from "bun:test";
import type { ExtraStep, ExtrasEvent } from "../src/setup/lib/extras/events.ts";
import type { HelperRun, RunHelper } from "../src/setup/lib/extras/helper.ts";
import type { ExtrasHardware } from "../src/setup/lib/extras/plan.ts";
import { type AppInstaller, ExtrasStore } from "../src/setup/lib/extras/store.ts";
import { installingContinueLabel, OFFLINE_NOTICE, runNotice, runSummary, stepLine } from "../src/setup/lib/extras/words.ts";
import type { InstalledApp } from "../src/shared/software/flatpak-parse.ts";
import type { OnProgress, Outcome } from "../src/shared/software/manager.ts";

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
