/**
 * Screen brightness: read from /sys/class/backlight, changed with
 * `brightnessctl` (which falls back to logind when the file is not
 * writable). Without a backlight (a desktop monitor) or without the tool,
 * the keys do nothing. Steps are 1/16, like the Mac's. The lowest is 0,
 * which on most laptop panels turns the backlight off, as the Mac's does:
 * Brightness Up (or the slider) brings it back.
 */

import { readdir } from "node:fs/promises";
import { hasProgram, type Run } from "./exec.ts";

export const BACKLIGHT = "/sys/class/backlight";

/** The keys step through this many levels. */
export const LEVELS = 16;

export interface Backlight {
  /** The sysfs device name, which brightnessctl takes with `--device`. */
  name: string;
  value: number;
  max: number;
}

/** What one device's files say; the numbers are as written there. */
export interface BacklightFiles {
  name: string;
  type: string | null;
  brightness: string | null;
  max: string | null;
}

/** Firmware controls beat platform ones, which beat raw hardware registers. */
const KIND_ORDER = ["firmware", "platform", "raw"];

function count(text: string | null): number | null {
  return text !== null && /^\d{1,12}$/.test(text) ? Number(text) : null;
}

/** The backlight to use out of several (a laptop can list two), or null. */
export function chooseBacklight(devices: readonly BacklightFiles[]): Backlight | null {
  const usable = devices.flatMap((device) => {
    const value = count(device.brightness);
    const max = count(device.max);
    if (value === null || max === null || max === 0) return [];
    const rank = KIND_ORDER.indexOf(device.type ?? "");
    return [{ name: device.name, value: Math.min(value, max), max, rank: rank === -1 ? KIND_ORDER.length : rank }];
  });
  usable.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const best = usable[0];
  return best ? { name: best.name, value: best.value, max: best.max } : null;
}

async function readText(path: string): Promise<string | null> {
  try {
    return (await Bun.file(path).text()).trim();
  } catch {
    return null;
  }
}

export async function readBacklight(root: string = BACKLIGHT): Promise<Backlight | null> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return null;
  }
  const devices = await Promise.all(
    names.map(async (name): Promise<BacklightFiles> => {
      const [type, brightness, max] = await Promise.all(["type", "brightness", "max_brightness"].map((file) => readText(`${root}/${name}/${file}`)));
      return { name, type: type ?? null, brightness: brightness ?? null, max: max ?? null };
    }),
  );
  return chooseBacklight(devices);
}

/** The 0..1 level, for the bar. */
export function levelOf(light: Backlight): number {
  return light.value / light.max;
}

/**
 * The raw value one step from `light`, on the grid of 1/16ths. A value near
 * a step (hardware rounds) counts as on it; one between steps moves to the
 * next step in that direction. The last step down is 0, the backlight off.
 */
export function steppedValue(light: Backlight, direction: "up" | "down"): number {
  const position = levelOf(light) * LEVELS;
  const nearest = Math.round(position);
  const delta = direction === "up" ? 1 : -1;
  const onStep = Math.abs(position - nearest) < 0.2;
  const next = onStep ? nearest + delta : direction === "up" ? Math.ceil(position) : Math.floor(position);
  return Math.round((light.max * Math.min(Math.max(next, 0), LEVELS)) / LEVELS);
}

/** Brighter or dimmer by a step; null if there is no backlight or no brightnessctl. */
export async function stepBrightness(
  run: Run,
  direction: "up" | "down",
  options: { root?: string; hasBrightnessctl?: boolean } = {},
): Promise<Backlight | null> {
  const hasTool = options.hasBrightnessctl ?? hasProgram("brightnessctl");
  if (!hasTool) return null;
  const before = await readBacklight(options.root);
  if (!before) return null;
  const target = steppedValue(before, direction);
  if (target !== before.value) {
    await run(["brightnessctl", "--quiet", `--device=${before.name}`, "set", String(target)]);
  }
  return readBacklight(options.root);
}

/** The raw value for a 0..1 level; 0 turns the backlight off. */
export function rawFor(light: Backlight, level: number): number {
  return Math.round(light.max * Math.min(Math.max(level, 0), 1));
}

/** Sets the brightness to `level` (0..1), as Control Center's slider does; false if it could not. */
export async function setBrightness(run: Run, light: Backlight, level: number): Promise<boolean> {
  const target = rawFor(light, level);
  return (await run(["brightnessctl", "--quiet", `--device=${light.name}`, "set", String(target)])) !== null;
}
