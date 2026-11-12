import { describe, expect, test } from "bun:test";
import { Flow, type Machine, pagesFor } from "../src/setup/flow.ts";
import { hasNvidiaGpu } from "../src/setup/lib/extras/hardware.ts";
import { appsFor, defaultChoices, type ExtrasHardware, stepsFor } from "../src/setup/lib/extras/plan.ts";
import { RECOMMENDED_APPS } from "../src/shared/software/recommended.ts";

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
