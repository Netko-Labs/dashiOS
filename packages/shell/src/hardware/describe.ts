/**
 * dashi-hardware's `Describe()` (docs/hardware.md, "Describe"): the machine,
 * its knobs with their ranges, its keys, lighting, quirks, and mode recipes.
 * The reply is JSON from a privileged service, still parsed strictly: a
 * field of the wrong kind is left out, never trusted.
 */

export type KnobValue = string | number | boolean;

export interface Knob {
  value: KnobValue | null;
  min?: number;
  max?: number;
  choices?: string[];
  unit?: string;
}

/** The kernel names of the laptop's own keys (`KEY_PROG3`), by what they do. */
export interface Hotkeys {
  mode?: string;
  lighting?: string;
  rog?: string;
  micMute?: string;
}

export interface Machine {
  /** The model database entry matched, or null. */
  model: string | null;
  vendor: string | null;
  product: string | null;
  laptop: boolean;
  knobs: ReadonlyMap<string, Knob>;
  hotkeys: Hotkeys;
  /** The keyboard light's levels above off (3 on the G14), null without one. */
  keyboardLevels: number | null;
  quirks: string[];
  /** The model's recipes as sent; power/modes/recipes.ts reads them. */
  recipes: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null);
const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const KNOB_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const KEY_NAME = /^KEY_[A-Z0-9_]{1,32}$/;

function parseKnob(raw: unknown): Knob | null {
  if (!isRecord(raw)) return null;
  const value = raw.value;
  const knob: Knob = { value: typeof value === "string" || typeof value === "boolean" || finite(value) !== undefined ? (value as KnobValue) : null };
  const min = finite(raw.min);
  const max = finite(raw.max);
  if (min !== undefined) knob.min = min;
  if (max !== undefined) knob.max = max;
  if (Array.isArray(raw.choices)) knob.choices = raw.choices.filter((choice): choice is string => typeof choice === "string" && choice.length <= 64);
  const unit = text(raw.unit);
  if (unit) knob.unit = unit;
  return knob;
}

/** `Describe()`'s JSON; null when it isn't an object at all. */
export function parseDescribe(json: string): Machine | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const knobs = new Map<string, Knob>();
  if (isRecord(raw.knobs)) {
    for (const [name, entry] of Object.entries(raw.knobs)) {
      const knob = KNOB_NAME.test(name) ? parseKnob(entry) : null;
      if (knob) knobs.set(name, knob);
    }
  }
  const hotkeys: Hotkeys = {};
  if (isRecord(raw.hotkeys)) {
    for (const role of ["mode", "lighting", "rog", "micMute"] as const) {
      const key = raw.hotkeys[role];
      if (typeof key === "string" && KEY_NAME.test(key)) hotkeys[role] = key;
    }
  }
  const lighting = isRecord(raw.lighting) ? raw.lighting : {};
  const keyboard = isRecord(lighting.keyboard) ? finite(lighting.keyboard.levels) : undefined;
  const backlight = knobs.get("kbd-backlight");
  return {
    model: text(raw.model),
    vendor: text(raw.vendor),
    product: text(raw.product),
    laptop: raw.laptop === true,
    knobs,
    hotkeys,
    keyboardLevels: keyboard !== undefined && keyboard > 0 ? Math.round(keyboard) : backlight?.max !== undefined && backlight.max > 0 ? backlight.max : null,
    quirks: Array.isArray(raw.quirks) ? raw.quirks.filter((quirk): quirk is string => typeof quirk === "string" && quirk.length <= 64) : [],
    recipes: raw.recipes ?? null,
  };
}

/** A knob's value clamped to what `Describe()` says it takes (the helper clamps again; this is for display and steps). */
export function clampKnob(knob: Knob | undefined, value: number): number {
  const low = knob?.min ?? Number.NEGATIVE_INFINITY;
  const high = knob?.max ?? Number.POSITIVE_INFINITY;
  return Math.min(Math.max(value, low), high);
}
