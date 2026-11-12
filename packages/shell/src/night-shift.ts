/**
 * Night Shift: warmer screens in the evening, macOS-style. Control Center's
 * switch (flags.night) turns it on and off; with a schedule in settings.json
 * the shell also flips that switch at the times given:
 *
 *   { "nightShift": { "from": "21:00", "to": "07:00", "kelvin": 3400 } }
 *
 * Bun decides the color: a color temperature becomes per-channel
 * multipliers, and dashi-comp scales every screen's gamma ramp by them (IPC
 * `gamma`; only real displays have ramps). Changes fade over a second and a
 * half instead of snapping.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRecord } from "@dashi/shape";
import type { Compositor } from "./compositor/index.ts";
import type { FlagsStore } from "./shared/control-center/index.ts";

export interface Tint {
  red: number;
  green: number;
  blue: number;
}

/** Daylight: the screen as it is. */
export const NEUTRAL_KELVIN = 6500;
/** How warm Night Shift is unless the settings say otherwise. */
export const DEFAULT_KELVIN = 3400;
const MIN_KELVIN = 1900;

const FADE_STEPS = 12;
const FADE_MS = 1500;

/** Approximate sRGB of a black body at `kelvin` (Tanner Helland's fit), 0 to 255 per channel. */
function blackBody(kelvin: number): Tint {
  const t = kelvin / 100;
  const clamp = (value: number) => Math.min(255, Math.max(0, value));
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return { red: clamp(red), green: clamp(green), blue: clamp(blue) };
}

/** Channel multipliers for `kelvin`, with daylight (6500 K) as no change; each at least 0.1. */
export function tintFor(kelvin: number): Tint {
  const k = Math.min(NEUTRAL_KELVIN, Math.max(MIN_KELVIN, kelvin));
  const white = blackBody(NEUTRAL_KELVIN);
  const color = blackBody(k);
  const channel = (value: number, reference: number) => Math.round(Math.min(1, Math.max(0.1, value / reference)) * 1000) / 1000;
  return { red: channel(color.red, white.red), green: channel(color.green, white.green), blue: channel(color.blue, white.blue) };
}

/** Minutes since midnight from "HH:MM"; null if it isn't a time. */
export function parseClock(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const match = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export interface Schedule {
  from: number;
  to: number;
}

/** Whether `minutes` (since midnight) falls in the schedule; it may run past midnight. */
export function inSchedule(minutes: number, schedule: Schedule): boolean {
  const { from, to } = schedule;
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

export interface NightSettings {
  kelvin: number;
  schedule: Schedule | null;
}

/** The `nightShift` part of settings.json, strictly read; anything off is the default. */
export function parseNightSettings(value: unknown): NightSettings {
  const section = isRecord(value) ? value.nightShift : undefined;
  if (!isRecord(section)) return { kelvin: DEFAULT_KELVIN, schedule: null };
  const { from, to, kelvin } = section;
  const start = parseClock(from);
  const end = parseClock(to);
  const warmth = typeof kelvin === "number" && Number.isFinite(kelvin) ? Math.min(NEUTRAL_KELVIN, Math.max(MIN_KELVIN, kelvin)) : DEFAULT_KELVIN;
  return { kelvin: warmth, schedule: start !== null && end !== null ? { from: start, to: end } : null };
}

function readNightSettings(env: Record<string, string | undefined> = process.env): NightSettings {
  const config = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  try {
    return parseNightSettings(JSON.parse(readFileSync(join(config, "dashi", "settings.json"), "utf8")));
  } catch {
    return parseNightSettings(null);
  }
}

/** Follows the switch and the schedule; returns a stop function. */
export function startNightShift(
  compositor: Pick<Compositor, "gamma">,
  flags: FlagsStore,
  options: { settings?: () => NightSettings; now?: () => Date } = {},
): () => void {
  const settings = options.settings ?? readNightSettings;
  const now = options.now ?? (() => new Date());
  let shown = NEUTRAL_KELVIN;
  let fade = 0;
  let quiet = false;

  /** Whether the screens took it. */
  const send = async (kelvin: number): Promise<boolean> => {
    try {
      await compositor.gamma(tintFor(kelvin));
      quiet = false;
      return true;
    } catch (error) {
      // No gamma ramps (a VM, a nested run): say so once.
      if (!quiet) console.log(`dashi-shell: Night Shift can't tint these screens: ${error instanceof Error ? error.message : String(error)}`);
      quiet = true;
      return false;
    }
  };

  const follow = async () => {
    const target = flags.getSnapshot().night ? settings().kelvin : NEUTRAL_KELVIN;
    if (target === shown) return;
    const generation = ++fade;
    const start = shown;
    for (let step = 1; step <= FADE_STEPS; step++) {
      if (generation !== fade) return;
      shown = Math.round(start + ((target - start) * step) / FADE_STEPS);
      // Screens that can't be tinted won't take the rest of the fade either.
      if (!(await send(shown))) {
        shown = target;
        return;
      }
      if (step < FADE_STEPS) await Bun.sleep(FADE_MS / FADE_STEPS);
    }
  };

  // With a schedule, the switch follows the clock at its edges: in between,
  // the person's own toggle stands.
  let lastInside: boolean | null = null;
  const tick = () => {
    const { schedule } = settings();
    if (!schedule) {
      lastInside = null;
      return;
    }
    const date = now();
    const inside = inSchedule(date.getHours() * 60 + date.getMinutes(), schedule);
    if (inside !== lastInside) flags.set({ night: inside });
    lastInside = inside;
  };

  const stopFlags = flags.subscribe(() => void follow());
  tick();
  void follow();
  const timer = setInterval(tick, 30_000);
  return () => {
    clearInterval(timer);
    stopFlags();
    fade++;
    if (shown !== NEUTRAL_KELVIN) void send(NEUTRAL_KELVIN);
  };
}
