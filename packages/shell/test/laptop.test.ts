import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Monitor } from "../src/display-config/monitors.ts";
import type { GraphicsSnapshot } from "../src/graphics/controller.ts";
import { HARDWARE, hardwareClient, knobVariant, parseBootGuard, parseTuning } from "../src/hardware/client.ts";
import { parseDescribe } from "../src/hardware/describe.ts";
import { detectLaptop, isLaptopChassis } from "../src/hardware/laptop.ts";
import { withRules } from "../src/keymap.ts";
import { KERNEL_KEYSYMS, laptopKeyRules, nextLightLevel } from "../src/laptop/hotkeys.ts";
import { type LaptopAction, laptopEntries } from "../src/laptop/menu.ts";
import { keyboardLight, type LaptopSnapshot, lightLabel } from "../src/laptop/store.ts";
import { resetSaidFor } from "../src/laptop/tuning.ts";
import { chargeTarget, fullChargeDone, inScheduleWindow } from "../src/power/battery-health.ts";
import { rateMode } from "../src/power/modes/screen-rate.ts";
import type { ModeSnapshot } from "../src/power/modes/store.ts";
import { FakeBus } from "./fake-bus.ts";

/** Describe() as the helper answers on the G14 (docs/hardware.md). */
const G14_DESCRIBE = JSON.stringify({
  model: "GA403WR",
  vendor: "ASUSTeK COMPUTER INC.",
  product: "ROG Zephyrus G14 GA403WR_GA403WR",
  laptop: true,
  knobs: {
    "platform-profile": { value: "balanced", choices: ["low-power", "balanced", "performance"] },
    "charge-limit": { value: 100, min: 20, max: 100 },
    "kbd-backlight": { value: 2, min: 0, max: 3 },
    "ppt-spl": { value: 80, min: 15, max: 80, unit: "W" },
    "Bad Name": { value: 1 },
    "gpu-mux": { value: 1, min: 0, max: 1 },
  },
  fans: [{ id: "cpu", label: "CPU fan", rpm: 2300, curve: true }],
  lighting: { keyboard: { levels: 3 }, slash: true, aura: false },
  hotkeys: { mode: "KEY_PROG3", lighting: "KEY_KBDILLUMTOGGLE", rog: "KEY_PROG1", micMute: "KEY_MICMUTE", junk: "rm -rf" },
  quirks: ["d3cold-drops"],
  recipes: null,
});

test("Describe: the knobs with their ranges, the keys, the light; a bad name or key is left out", () => {
  const machine = parseDescribe(G14_DESCRIBE);
  expect(machine?.model).toBe("GA403WR");
  expect(machine?.laptop).toBe(true);
  expect([...(machine?.knobs.keys() ?? [])]).toEqual(["platform-profile", "charge-limit", "kbd-backlight", "ppt-spl", "gpu-mux"]);
  expect(machine?.knobs.get("ppt-spl")).toEqual({ value: 80, min: 15, max: 80, unit: "W" });
  expect(machine?.hotkeys).toEqual({ mode: "KEY_PROG3", lighting: "KEY_KBDILLUMTOGGLE", rog: "KEY_PROG1", micMute: "KEY_MICMUTE" });
  expect(machine?.keyboardLevels).toBe(3);
  expect(parseDescribe("not json")).toBeNull();
  expect(parseDescribe("[]")).toBeNull();
});

test("the helper's tuning replies", () => {
  expect(parseTuning('{"applied": false, "reason": "unclean boot"}')).toEqual({ applied: false, reason: "unclean boot" });
  expect(parseBootGuard('{"cleanBoot": true, "failedBoots": 2, "reset": true}')).toEqual({ cleanBoot: true, failedBoots: 2, reset: true });
  expect(parseBootGuard('{"cleanBoot": "yes"}')).toBeNull();
  expect(resetSaidFor('{"resetNoticeBoot":"b1"}', "b1")).toBe(true);
  expect(resetSaidFor('{"resetNoticeBoot":"b1"}', "b2")).toBe(false);
  expect(resetSaidFor(null, "b1")).toBe(false);
});

test("the client: knobs go as s, b, or u; SetMany sends one dictionary; no helper is null", async () => {
  expect(knobVariant("balanced").signature).toBe("s");
  expect(knobVariant(true).signature).toBe("b");
  expect(knobVariant(79.6)).toMatchObject({ signature: "u", value: 80 });
  const bus = new FakeBus().on(HARDWARE.path, HARDWARE.interface, "SetMany", ([values]) => [values]);
  const client = hardwareClient(bus.link());
  expect(await client.setMany({ "platform-profile": "performance", "ppt-spl": 80 })).toEqual({ "platform-profile": "performance", "ppt-spl": 80 });
  expect(bus.callsTo("SetMany")[0]?.interactive).toBe(true);
  expect(await client.describe()).toBeNull();
});

test("the laptop check without the helper: a portable chassis and a system battery", () => {
  expect(isLaptopChassis("10\n")).toBe(true);
  expect(isLaptopChassis("3")).toBe(false);
  expect(isLaptopChassis(null)).toBe(false);
  const root = mkdtempSync(join(tmpdir(), "dashi-laptop-"));
  mkdirSync(join(root, "dmi"));
  writeFileSync(join(root, "dmi", "chassis_type"), "10\n");
  const supplies = join(root, "supplies");
  mkdirSync(join(supplies, "hidpp_battery_0"), { recursive: true });
  writeFileSync(join(supplies, "hidpp_battery_0", "type"), "Battery\n");
  writeFileSync(join(supplies, "hidpp_battery_0", "scope"), "Device\n");
  // A mouse's battery is not the system's.
  expect(detectLaptop(join(root, "dmi"), supplies)).toBe(false);
  mkdirSync(join(supplies, "BAT1"));
  writeFileSync(join(supplies, "BAT1", "type"), "Battery\n");
  expect(detectLaptop(join(root, "dmi"), supplies)).toBe(true);
});

test("the hotkey mapping: the model's kernel keys become keysym rules bound to the laptop's actions", () => {
  const machine = parseDescribe(G14_DESCRIBE);
  const rules = laptopKeyRules(machine?.hotkeys ?? {}, true);
  expect(rules).toEqual([
    { when: "XF86Launch3", bind: "laptop-mode" },
    { when: "XF86KbdLightOnOff", bind: "laptop-light" },
    { when: "XF86Launch1", bind: "laptop-rog" },
    { when: "XF86AudioMicMute", bind: "mic-mute" },
    { when: "XF86KbdBrightnessUp", bind: "laptop-light-up" },
    { when: "XF86KbdBrightnessDown", bind: "laptop-light-down" },
  ]);
  // No keyboard light: no light keys. An unknown kernel key: no rule.
  expect(laptopKeyRules({ lighting: "KEY_KBDILLUMTOGGLE", rog: "KEY_ASSISTANT" }, false)).toEqual([]);
  expect(KERNEL_KEYSYMS.KEY_PROG3).toBe("XF86Launch3");
  const keymap = withRules({ apps: {}, tapMs: 1, holdMs: 2, rules: [{ when: "XF86AudioMute", bind: "volume-mute" }] }, rules.slice(0, 1));
  expect(keymap.rules.map((rule) => rule.when)).toEqual(["XF86Launch3", "XF86AudioMute"]);
});

test("the keyboard light: Fn F4 steps up then off; the levels have names", () => {
  expect([0, 1, 2, 3].map((level) => nextLightLevel(level, 3, "cycle"))).toEqual([1, 2, 3, 0]);
  expect(nextLightLevel(3, 3, "up")).toBe(3);
  expect(nextLightLevel(0, 3, "down")).toBe(0);
  expect([0, 1, 2, 3].map((level) => lightLabel(level, 3))).toEqual(["Off", "Low", "Medium", "High"]);
});

test("battery health: the limit, a full charge once, and the schedule's window", () => {
  const monday7 = new Date(2026, 10, 2, 7, 0);
  const saturday7 = new Date(2026, 10, 7, 7, 0);
  expect(chargeTarget({}, monday7)).toEqual({ percent: null, why: null });
  expect(chargeTarget({ chargeLimit: 80 }, monday7)).toEqual({ percent: 80, why: "Charging stops at 80%" });
  expect(chargeTarget({ chargeLimit: 80, fullChargeOnce: true }, monday7).percent).toBe(100);
  expect(chargeTarget({ chargeLimit: 80, fullBy: "08:00" }, monday7)).toEqual({ percent: 100, why: "Charging to full by 08:00" });
  expect(chargeTarget({ chargeLimit: 80, fullBy: "08:00" }, saturday7).percent).toBe(80);
  expect(chargeTarget({ chargeLimit: 80, fullBy: "08:00", fullByDays: "daily" }, saturday7).percent).toBe(100);
  expect(inScheduleWindow({ fullBy: "08:00" }, new Date(2026, 10, 2, 4, 59))).toBe(false);
  expect(inScheduleWindow({ fullBy: "08:00" }, new Date(2026, 10, 2, 8, 0))).toBe(false);
  // 01:00 starts at 22:00 the evening before (a Sunday evening, for Monday).
  expect(inScheduleWindow({ fullBy: "01:00" }, new Date(2026, 10, 1, 22, 30))).toBe(true);
  expect(fullChargeDone({ plugged: true, percent: 100 }, true)).toBe(true);
  expect(fullChargeDone({ plugged: false, percent: 90 }, true)).toBe(true);
  expect(fullChargeDone({ plugged: true, percent: 90 }, true)).toBe(false);
});

const panel = (current: number): Monitor =>
  ({
    name: "eDP-1",
    builtIn: true,
    enabled: true,
    mode: { width: 2880, height: 1800, refreshMhz: current },
    modes: [
      { width: 2880, height: 1800, refreshMhz: 120_000, preferred: true, current: current === 120_000 },
      { width: 2880, height: 1800, refreshMhz: 60_000, preferred: false, current: current === 60_000 },
      { width: 1920, height: 1200, refreshMhz: 144_000, preferred: false, current: false },
    ],
  }) as unknown as Monitor;

test("the recipe's screen line: the panel's rate at its size, nothing when it is already there", () => {
  expect(rateMode(panel(120_000), 60)).toEqual({ width: 2880, height: 1800, refreshMhz: 60_000 });
  expect(rateMode(panel(60_000), "max")).toEqual({ width: 2880, height: 1800, refreshMhz: 120_000 });
  expect(rateMode(panel(120_000), "max")).toBeNull();
});

const laptopSnapshot: LaptopSnapshot = {
  laptop: true,
  helper: true,
  model: "GA403WR",
  knobs: parseDescribe(G14_DESCRIBE)?.knobs ?? new Map(),
  keyboardLevels: 3,
};
const modes: ModeSnapshot = {
  available: ["low-power", "balanced", "performance"],
  choice: "automatic",
  effective: { mode: "balanced", column: "battery", automatic: true, why: "Automatic chose Balanced: on battery" },
  failed: false,
};

test("the battery menu as the hub: the mode and why, the charge, the card's holders with Quit", () => {
  const graphics = {
    hasCard: true,
    switchable: true,
    choice: "automatic",
    mode: "hybrid",
    decision: { set: null, wanted: "integrated", waitingFor: ["Steam"], why: "Switches to the built-in graphics when Steam quits" },
    holders: [
      { name: "Steam", pids: [5900], watts: 38 },
      { name: "gamescope", pids: [], watts: 4 },
    ],
    power: "active",
    lost: null,
    cards: [],
    allowed: [],
  } as GraphicsSnapshot;
  const entries = laptopEntries<LaptopAction>(
    { laptop: laptopSnapshot, modes, graphics, power: { chargeLimit: 80 }, now: new Date(2026, 10, 2, 12) },
    (action) => action,
  );
  const labels = entries.map((entry) => (entry.kind === "item" ? `${entry.checked ? "✓ " : ""}${entry.label}${entry.keys ? ` [${entry.keys}]` : ""}` : "—"));
  expect(labels).toEqual([
    "—",
    "Power Mode",
    "✓ Automatic · Balanced now",
    "Low Power",
    "Balanced",
    "High Performance",
    "Automatic chose Balanced: on battery.",
    "—",
    "Charging stops at 80%",
    "Charge to Full Once",
    "—",
    "Using the Graphics Card",
    "Steam · ~38 W [Quit]",
    "gamescope · ~4 W",
    "Switches to the built-in graphics when Steam quits",
  ]);
  const steam = entries.find((entry) => entry.kind === "item" && entry.label.startsWith("Steam"));
  expect(steam?.kind === "item" ? steam.action : null).toEqual({ kind: "quit-holder", name: "Steam" });
});

test("no modes, not a laptop, one GPU: the menu has no laptop sections", () => {
  const entries = laptopEntries(
    { laptop: { ...laptopSnapshot, laptop: false }, modes: { ...modes, available: [], effective: null }, graphics: null, power: {}, now: new Date() },
    (action) => action,
  );
  expect(entries).toEqual([]);
  expect(keyboardLight({ ...laptopSnapshot, knobs: new Map() })).toBeNull();
});
