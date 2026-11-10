import { expect, test } from "bun:test";
import type { HardwareApi } from "../src/hardware/client.ts";
import type { Knob, KnobValue } from "../src/hardware/describe.ts";
import { automaticMode, effectiveMode } from "../src/power/modes/automatic.ts";
import { EchoGuard } from "../src/power/modes/guard.ts";
import { DEFAULT_RECIPES, parseRecipes, resolveRecipe } from "../src/power/modes/recipes.ts";
import type { PowerSection } from "../src/power/modes/settings.ts";
import { ModeStore } from "../src/power/modes/store.ts";
import type { ModeChoice } from "../src/power/modes/types.ts";
import type { ProfileId, ProfileSource } from "../src/system/profiles.ts";
import { settle as flush } from "./support/time.ts";

/** The G14's knobs, as dashi-hardware describes them. */
const G14_KNOBS = new Map<string, Knob>([
  ["platform-profile", { value: "balanced", choices: ["low-power", "balanced", "performance"] }],
  ["epp", { value: "balance_performance", choices: ["default", "performance", "balance_performance", "balance_power", "power"] }],
  ["boost", { value: true }],
  ["cpu-max-freq", { value: 0, min: 623_000, max: 5_157_000 }],
  ["ppt-spl", { value: 80, min: 15, max: 80, unit: "W" }],
  ["charge-limit", { value: 100, min: 20, max: 100 }],
]);

/** The model database's GA403WR recipes (docs/hardware.md). */
const GA403WR = parseRecipes({
  "low-power": {
    plugged: { "platform-profile": "low-power", epp: "power", "ppt-spl": 30 },
    battery: { "platform-profile": "low-power", epp: "power", "ppt-spl": 15, boost: false },
  },
  balanced: {
    plugged: { "platform-profile": "balanced", epp: "balance_performance", "ppt-spl": 55 },
    battery: { "platform-profile": "balanced", epp: "balance_power", "ppt-spl": 30 },
  },
  performance: {
    plugged: { "platform-profile": "performance", epp: "performance", "ppt-spl": 80, "screen-rate": "max" },
    battery: { "platform-profile": "balanced", epp: "balance_performance", "ppt-spl": 45, "screen-rate": 60 },
  },
});

test("recipe resolution per column: the cable switches columns, not modes", () => {
  // An older model file's "screen-rate" is left out: the rate is Displays' Automatic now, and it is no knob.
  expect(resolveRecipe(GA403WR, "performance", "plugged", G14_KNOBS)).toEqual({
    knobs: { "platform-profile": "performance", epp: "performance", "ppt-spl": 80 },
  });
  expect(resolveRecipe(GA403WR, "performance", "battery", G14_KNOBS)).toEqual({
    knobs: { "platform-profile": "balanced", epp: "balance_performance", "ppt-spl": 45 },
  });
  expect(resolveRecipe(GA403WR, "low-power", "battery", G14_KNOBS).knobs.boost).toBe(false);
});

test("a recipe is cut to the knobs this machine has and the values they take", () => {
  // No power limits on this machine, and an EPP it doesn't offer.
  const knobs = new Map<string, Knob>([
    ["platform-profile", { value: "balanced", choices: ["low-power", "balanced"] }],
    ["epp", { value: "balance_power", choices: ["power", "balance_power"] }],
  ]);
  expect(resolveRecipe(GA403WR, "performance", "plugged", knobs).knobs).toEqual({});
  expect(resolveRecipe(GA403WR, "balanced", "battery", knobs).knobs).toEqual({ "platform-profile": "balanced", epp: "balance_power" });
  // An out-of-range power limit is left out (the helper would clamp it; the shell doesn't send it).
  const narrow = new Map<string, Knob>([["ppt-spl", { value: 30, min: 15, max: 40 }]]);
  expect(resolveRecipe(GA403WR, "performance", "plugged", narrow).knobs).toEqual({});
});

test("without the model's recipes, tuned's defaults; a model that leaves a mode out gets the default for it", () => {
  expect(parseRecipes(null)).toBe(DEFAULT_RECIPES);
  const partial = parseRecipes({ balanced: { plugged: { "platform-profile": "balanced", "ppt-spl": 50 } } });
  expect(partial.balanced.plugged.knobs).toEqual({ "platform-profile": "balanced", "ppt-spl": 50 });
  expect(partial.balanced.battery).toBe(DEFAULT_RECIPES.balanced.battery);
  expect(partial.performance).toEqual(DEFAULT_RECIPES.performance);
});

test("the processor settings lay over the recipe: boost, EPP, the battery's top speed", () => {
  const settings: PowerSection = { boost: "plugged", epp: "power", batteryMaxKhz: 3_900_000 };
  expect(resolveRecipe(GA403WR, "balanced", "battery", G14_KNOBS, settings).knobs).toEqual({
    "platform-profile": "balanced",
    epp: "power",
    "ppt-spl": 30,
    boost: false,
    "cpu-max-freq": 3_900_000,
  });
  // Plugged in, the cap is lifted (0) and boost is on.
  const plugged = resolveRecipe(GA403WR, "balanced", "plugged", G14_KNOBS, settings).knobs;
  expect(plugged["cpu-max-freq"]).toBe(0);
  expect(plugged.boost).toBe(true);
});

test("Automatic's choices: High Performance plugged in, Balanced on battery, Low Power below 20%", () => {
  expect(automaticMode({ plugged: true, percent: 15 }).mode).toBe("performance");
  expect(automaticMode({ plugged: true, percent: null })).toEqual({ mode: "balanced", why: "no battery" });
  expect(automaticMode({ plugged: false, percent: 64 }).mode).toBe("balanced");
  expect(automaticMode({ plugged: false, percent: 19 })).toEqual({ mode: "low-power", why: "battery below 20%" });
  expect(automaticMode({ plugged: false, percent: 20 }).mode).toBe("balanced");
  expect(effectiveMode("automatic", null, { plugged: false, percent: 64 }).why).toBe("Automatic chose Balanced: on battery");
});

test("a manual pick wins; a key press holds a mode over Automatic", () => {
  expect(effectiveMode("low-power", null, { plugged: true, percent: 80 })).toMatchObject({ mode: "low-power", column: "plugged", automatic: false });
  expect(effectiveMode("automatic", "performance", { plugged: false, percent: 80 })).toMatchObject({
    mode: "performance",
    column: "battery",
    automatic: false,
  });
});

test("the guard: an echo is used up once; anything else, or an echo too late, is someone else's", () => {
  let now = 0;
  const guard = new EchoGuard(() => now);
  guard.expect("platform-profile", "performance");
  expect(guard.isEcho("platform-profile", "balanced")).toBe(false);
  expect(guard.isEcho("platform-profile", "performance")).toBe(true);
  expect(guard.isEcho("platform-profile", "performance")).toBe(false);
  guard.expect("profile", "balanced");
  now = 6000;
  expect(guard.isEcho("profile", "balanced")).toBe(false);
});

/** dashi-hardware in memory: SetMany writes the knobs and, as the real one does, says Changed for each that changed. */
function fakeHardware(knobs: Map<string, Knob>) {
  const listeners = new Set<(knob: string, value: KnobValue | null) => void>();
  const writes: Array<Record<string, KnobValue>> = [];
  const change = (name: string, value: KnobValue) => {
    const knob = knobs.get(name);
    if (!knob || knob.value === value) return;
    knobs.set(name, { ...knob, value });
    for (const listener of [...listeners]) listener(name, value);
  };
  const api: HardwareApi = {
    describe: async () => null,
    set: async (name, value) => {
      change(name, value);
      return value;
    },
    setMany: async (values) => {
      writes.push({ ...values });
      // The signal comes back after the call returns, the way it does over the bus.
      queueMicrotask(() => {
        for (const [name, value] of Object.entries(values)) change(name, value);
      });
      return { ...values };
    },
    applySavedTuning: async () => null,
    bootGuard: async () => null,
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  /** Fn F5: the firmware cycles the profile by itself. */
  const press = (value: string) => change("platform-profile", value);
  return { api, writes, press };
}

function fakeProfiles(active: ProfileId) {
  const sets: ProfileId[] = [];
  let listener: ((profiles: { available: ProfileId[]; active: ProfileId }) => void) | null = null;
  const state = { active };
  const source: ProfileSource = {
    read: async () => ({ available: ["power-saver", "balanced", "performance"], active: state.active }),
    set: async (id) => {
      sets.push(id);
      state.active = id;
      queueMicrotask(() => listener?.({ available: ["power-saver", "balanced", "performance"], active: id }));
      return true;
    },
    watch: (each) => {
      listener = each;
      return () => {};
    },
  };
  return { source, sets, state };
}

async function laptop(choice: ModeChoice = "automatic") {
  const hardware = fakeHardware(new Map(G14_KNOBS));
  const profiles = fakeProfiles("balanced");
  const saved: ModeChoice[] = [];
  const announced: string[] = [];
  let settings: PowerSection = { mode: choice };
  const store = new ModeStore({
    profiles: profiles.source,
    hardware: hardware.api,
    settings: () => settings,
    saveChoice: (mode) => {
      saved.push(mode);
      settings = { ...settings, mode };
    },
    announce: (mode) => void announced.push(mode),
  });
  hardware.api.onChanged((knob, value) => store.knobChanged(knob, value));
  profiles.source.watch((read) => read && store.setProfiles(read.available, read.active));
  store.setProfiles(["power-saver", "balanced", "performance"], "balanced");
  store.setMachine({ knobs: G14_KNOBS, recipes: GA403WR });
  store.setPowerSource({ plugged: false, percent: 70 });
  await flush();
  await store.idle();
  return { store, hardware, profiles, saved, announced };
}

test("the store applies the recipe once for the mode in effect: tuned-ppd's profile, then the knobs", async () => {
  const { store, hardware, profiles } = await laptop();
  expect(store.getSnapshot().effective?.mode).toBe("balanced");
  expect(hardware.writes).toEqual([{ "platform-profile": "balanced", epp: "balance_power", "ppt-spl": 30 }]);
  // tuned-ppd was already on balanced.
  expect(profiles.sets).toEqual([]);
});

test("the cable switches columns, not modes", async () => {
  const { store, hardware } = await laptop("performance");
  store.setPowerSource({ plugged: true, percent: 70 });
  await flush();
  await store.idle();
  expect(store.getSnapshot().effective).toMatchObject({ mode: "performance", column: "plugged" });
  expect(hardware.writes.at(-1)).toEqual({ "platform-profile": "performance", epp: "performance", "ppt-spl": 80 });
});

test("both ways: one Fn F5 press makes one change, and its echoes make none", async () => {
  const { store, hardware, profiles, announced } = await laptop();
  const before = hardware.writes.length;
  hardware.press("performance");
  await flush();
  await store.idle();
  await flush();
  await store.idle();
  // Automatic yields to the key until the cable changes; the rest of the recipe followed, once.
  expect(store.getSnapshot().effective).toMatchObject({ mode: "performance", automatic: false });
  expect(hardware.writes.length - before).toBe(1);
  // High Performance's battery column: the firmware goes back to the column's own profile.
  expect(hardware.writes.at(-1)).toEqual({ "platform-profile": "balanced", epp: "balance_performance", "ppt-spl": 45 });
  expect(profiles.sets).toEqual(["performance"]);
  expect(announced).toEqual(["performance"]);
  // Plugging in ends the hold: Automatic again.
  store.setPowerSource({ plugged: true, percent: 70 });
  await flush();
  await store.idle();
  expect(store.getSnapshot().effective).toMatchObject({ mode: "performance", automatic: true });
});

test("a pick from the menu writes once, and the echoes of that write are not taken for a key press", async () => {
  const { store, hardware, saved, announced } = await laptop();
  const before = hardware.writes.length;
  store.choose("low-power");
  await flush();
  await store.idle();
  await flush();
  expect(hardware.writes.length - before).toBe(1);
  expect(saved).toEqual(["low-power"]);
  expect(announced).toEqual([]);
  expect(store.getSnapshot().choice).toBe("low-power");
});

test("with a manual pick, a key press becomes the new pick", async () => {
  const { store, hardware, saved } = await laptop("balanced");
  hardware.press("low-power");
  await flush();
  await store.idle();
  expect(saved).toEqual(["low-power"]);
  expect(store.getSnapshot().choice).toBe("low-power");
});

test("no tuned-ppd and no helper: no modes, and nothing is written", () => {
  const store = new ModeStore({ profiles: null, hardware: null, settings: () => ({}), saveChoice: () => {} });
  store.setProfiles(null, null);
  store.setMachine(null);
  store.setPowerSource({ plugged: true, percent: null });
  expect(store.getSnapshot()).toMatchObject({ available: [], effective: null });
});

test("Fn F5 again from a column that uses a lower profile: the next mode, not the same one", async () => {
  const { store, hardware } = await laptop();
  hardware.press("performance");
  await flush();
  await store.idle();
  await flush();
  // On battery High Performance runs the firmware at balanced; the firmware's next step is performance again.
  hardware.press("performance");
  await flush();
  await store.idle();
  await flush();
  expect(store.getSnapshot().effective?.mode).toBe("low-power");
  expect(hardware.writes.at(-1)?.["platform-profile"]).toBe("low-power");
});

test("tuned-ppd alone (no helper): Automatic sets its profile; a change from another program is taken, once", async () => {
  const profiles = fakeProfiles("balanced");
  const store = new ModeStore({ profiles: profiles.source, hardware: null, settings: () => ({}), saveChoice: () => {} });
  profiles.source.watch((read) => read && store.setProfiles(read.available, read.active));
  store.setProfiles(["power-saver", "balanced", "performance"], "balanced");
  store.setMachine(null);
  store.setPowerSource({ plugged: true, percent: 50 });
  await flush();
  await store.idle();
  await flush();
  expect(profiles.sets).toEqual(["performance"]);
  // `powerprofilesctl set power-saver` in a terminal.
  store.setProfiles(["power-saver", "balanced", "performance"], "power-saver");
  await flush();
  await store.idle();
  expect(store.getSnapshot().effective?.mode).toBe("low-power");
  expect(profiles.sets).toEqual(["performance"]);
});
