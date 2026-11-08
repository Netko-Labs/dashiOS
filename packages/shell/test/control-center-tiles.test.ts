/**
 * What each of Control Center's tiles says and does (control-center/
 * catalog.ts), the sliders' numbers (slider-math.ts), an applet slider's
 * range (applet-tiles.ts), and the layout kept per machine
 * (layout-store.ts).
 */

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { levelOf, nextChoice, valueAt } from "../src/control-center/applet-tiles.ts";
import { type ControlSnapshot, DEFAULT_LAYOUT, isThere, lightToggle, powerToggle, SYSTEM_CONTROLS, tileState } from "../src/control-center/catalog.ts";
import { LayoutStore, machineId, parseLayouts } from "../src/control-center/layout-store.ts";
import { fillLength, levelAt, stepLevel } from "../src/shared/controls/slider-math.ts";

const laptop: ControlSnapshot = {
  wifi: true,
  network: { kind: "wifi", ssid: "Casa Alex 5G", bars: 3 },
  bluetooth: true,
  bluetoothDevice: "AirPods Pro",
  brightness: 0.68,
  volume: { level: 0.42, muted: false },
  dnd: false,
  dark: true,
  night: false,
  power: { choice: "automatic", mode: "balanced" },
  light: { level: 1, max: 3, name: "Low" },
  graphics: null,
  battery: { percent: 84, charging: false, limit: 80, time: "5 h 10 min" },
  hotspot: false,
};

const desktop: ControlSnapshot = {
  ...laptop,
  wifi: null,
  network: { kind: "wired" },
  bluetooth: null,
  bluetoothDevice: null,
  brightness: null,
  power: null,
  light: null,
  battery: null,
  hotspot: null,
};

test("the tiles say what the design shows: the network, the device, Auto and the mode, the light's level", () => {
  const say = (id: string) => {
    const state = tileState(id, laptop);
    return state ? `${state.title} · ${state.detail} · ${state.on ? "on" : "off"}` : null;
  };
  expect(say("wifi")).toBe("Wi-Fi · Casa Alex 5G · on");
  expect(say("bluetooth")).toBe("Bluetooth · AirPods Pro · on");
  expect(say("focus")).toBe("Focus · Off · off");
  expect(say("dark")).toBe("Dark · On · on");
  expect(say("power")).toBe("Power · Auto · Balanced · on");
  expect(say("keyboard")).toBe("Keyboard · Low · on");
  expect(say("brightness")).toBe("Display · 68% · off");
  expect(say("volume")).toBe("Sound · 42% · off");
  expect(tileState("power", { ...laptop, power: { choice: "performance", mode: "performance" } })?.detail).toBe("High Performance");
  expect(tileState("wifi", { ...laptop, wifi: false })?.detail).toBe("Off");
  expect(tileState("volume", { ...laptop, volume: { level: 0.4, muted: true } })?.detail).toBe("Muted");
});

test("the battery row's glyph is the bolt only while charging", () => {
  const discharging = tileState("battery", laptop)?.glyph;
  const charging = tileState("battery", { ...laptop, battery: { percent: 62, charging: true, limit: 80, time: "16 min to 80%" } })?.glyph;
  expect(discharging).not.toBe(charging);
  expect(charging).toContain("M8.9 1.6");
  expect(discharging).not.toContain("M8.9 1.6");
});

test("tiles for missing hardware are never there; a wired desktop has Ethernet instead of Wi-Fi", () => {
  const there = (snap: ControlSnapshot) => SYSTEM_CONTROLS.filter((control) => isThere(control.id, snap)).map((control) => control.id);
  expect(there(laptop)).toEqual(["wifi", "bluetooth", "brightness", "volume", "focus", "dark", "power", "keyboard", "battery", "lock", "night", "hotspot"]);
  expect(there(desktop)).toEqual(["ethernet", "volume", "focus", "dark", "lock", "night"]);
  expect(tileState("battery", desktop)).toBeNull();
  expect(isThere("applet:dev.example/x", laptop)).toBe(false);
  // Every control in the default layout is one Dashi knows.
  expect(DEFAULT_LAYOUT.every((item) => SYSTEM_CONTROLS.some((control) => control.id === item.id && control.sizes.includes(item.size)))).toBe(true);
});

test("the power knob holds the mode Automatic chose, or gives the choice back; the light's knob brings back its level", () => {
  expect(powerToggle({ choice: "automatic", mode: "balanced" })).toBe("balanced");
  expect(powerToggle({ choice: "automatic", mode: null })).toBe("balanced");
  expect(powerToggle({ choice: "low-power", mode: "low-power" })).toBe("automatic");
  expect(lightToggle({ level: 2, max: 3 }, null)).toBe(0);
  expect(lightToggle({ level: 0, max: 3 }, 2)).toBe(2);
  expect(lightToggle({ level: 0, max: 3 }, null)).toBe(1);
  expect(lightToggle({ level: 0, max: 1 }, 3)).toBe(1);
});

test("a slider's level is where the pointer is: from the bottom standing, from the left lying; ⇧ and an arrow step a tenth", () => {
  const box = { x: 100, y: 50, width: 74, height: 184 };
  expect(levelAt(box, 120, 50, true)).toBe(1);
  expect(levelAt(box, 120, 234, true)).toBe(0);
  expect(levelAt(box, 120, 142, true)).toBeCloseTo(0.5);
  expect(levelAt(box, 120, 400, true)).toBe(0);
  expect(levelAt(box, 137, 0, false)).toBeCloseTo(0.5);
  expect(levelAt({ ...box, height: 0 }, 0, 0, true)).toBe(0);
  expect(fillLength(0.68, 184)).toBe(125);
  expect(fillLength(1.4, 184)).toBe(184);
  expect(stepLevel(0.68, "up")).toBe(0.8);
  expect(stepLevel(0.68, "left")).toBe(0.6);
  expect(stepLevel(1, "right")).toBe(1);
  expect(stepLevel(0.05, "down")).toBe(0);
});

test("an applet's slider maps its range; a choice's knob steps round its choices", () => {
  expect(levelOf({ min: 0, max: 100, value: 40 })).toBe(0.4);
  expect(levelOf({ min: 10, max: 10, value: 10 })).toBe(0);
  expect(levelOf({ min: 0, max: 100, value: null })).toBe(0);
  expect(valueAt({ min: 0, max: 100 }, 0.426)).toBe(43);
  expect(valueAt({ min: 0, max: 5 }, 0.5)).toBe(2.5);
  expect(nextChoice({ choices: ["Quiet", "Auto", "Max"], choice: "Max" })).toBe("Quiet");
  expect(nextChoice({ choices: ["Quiet", "Auto"], choice: null })).toBe("Quiet");
  expect(nextChoice({ choices: [], choice: null })).toBeNull();
});

test("the layout is kept per machine: another machine's stays as it was", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-layout-"));
  try {
    const path = join(dir, "layout.json");
    const first = new LayoutStore(path, "a".repeat(32));
    expect(first.getSnapshot()).toEqual(DEFAULT_LAYOUT);
    first.set([{ id: "dark", size: "wide" }]);
    const second = new LayoutStore(path, "b".repeat(32));
    expect(second.getSnapshot()).toEqual(DEFAULT_LAYOUT);
    second.set([{ id: "lock", size: "round" }]);
    expect(new LayoutStore(path, "a".repeat(32)).getSnapshot()).toEqual([{ id: "dark", size: "wide" }]);
    expect([...parseLayouts(readFileSync(path, "utf8")).keys()].sort()).toEqual(["a".repeat(32), "b".repeat(32)]);
    second.reset();
    expect(new LayoutStore(path, "b".repeat(32)).getSnapshot()).toEqual(DEFAULT_LAYOUT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(machineId(() => "0123456789abcdef0123456789abcdef\n")).toBe("0123456789abcdef0123456789abcdef");
  expect(machineId(() => "../../etc")).toBe("this");
  expect(
    machineId(() => {
      throw new Error("no file");
    }),
  ).toBe("this");
  expect(parseLayouts("{not json").size).toBe(0);
});
