/**
 * A mode's recipe for this machine: the model's own, from dashi-hardware's
 * `Describe().recipes` (the model database), else tuned's defaults (the
 * platform profile and EPP that tuned's stock profiles would set; Dashi's
 * tuned profiles leave those two to the recipe, so one writer owns each).
 * A recipe is cut down to the knobs the machine has, with values it takes,
 * and the person's processor settings (boost, EPP, the battery's top speed)
 * are laid over it, so they too reach the hardware in the recipe's one write.
 */

import type { Knob, KnobValue } from "../../hardware/index.ts";
import type { PowerSection } from "./settings.ts";
import { type Column, isMode, MODES, type Mode, type Recipe, type Recipes } from "./types.ts";

const knobs = (values: Record<string, KnobValue>): Recipe => ({ knobs: values });

/** What tuned's own powersave, balanced, and throughput-performance profiles do, as recipes. */
export const DEFAULT_RECIPES: Recipes = {
  "low-power": {
    plugged: knobs({ "platform-profile": "low-power", epp: "power" }),
    battery: knobs({ "platform-profile": "low-power", epp: "power" }),
  },
  balanced: {
    plugged: knobs({ "platform-profile": "balanced", epp: "balance_performance" }),
    battery: knobs({ "platform-profile": "balanced", epp: "balance_power" }),
  },
  performance: {
    plugged: knobs({ "platform-profile": "performance", epp: "performance" }),
    battery: knobs({ "platform-profile": "performance", epp: "balance_performance" }),
  },
};

/**
 * A key an older model file may hold that is not a knob: the screen's rate
 * was a recipe's once, and is Displays' Automatic refresh rate now
 * (display-config/auto-refresh.ts), so it is left out, never sent as a knob.
 */
const SCREEN_RATE = "screen-rate";
const KNOB_NAME = /^[a-z][a-z0-9-]{0,63}$/;

function parseColumn(raw: unknown): Recipe | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const values: Record<string, KnobValue> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name === SCREEN_RATE || !KNOB_NAME.test(name)) continue;
    if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) values[name] = value;
  }
  return { knobs: values };
}

/** The model's recipes; a mode or column the model leaves out is tuned's default. */
export function parseRecipes(raw: unknown): Recipes {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return DEFAULT_RECIPES;
  const record = raw as Record<string, unknown>;
  const out = {} as Record<Mode, Record<Column, Recipe>>;
  for (const mode of MODES) {
    const entry = record[mode];
    const columns = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    out[mode] = {
      plugged: parseColumn(columns.plugged) ?? DEFAULT_RECIPES[mode].plugged,
      battery: parseColumn(columns.battery) ?? DEFAULT_RECIPES[mode].battery,
    };
  }
  return out;
}

/** Whether `value` is one `knob` takes, as far as the shell can tell (the helper clamps the rest). */
function fits(knob: Knob, value: KnobValue): boolean {
  if (knob.choices && knob.choices.length > 0) return typeof value === "string" && knob.choices.includes(value);
  if (typeof value === "number") return (knob.min === undefined || value >= knob.min) && (knob.max === undefined || value <= knob.max);
  return true;
}

/**
 * The column of `mode` to write on this machine: the recipe's knobs the
 * machine has, with values it takes, and the processor settings over them.
 */
export function resolveRecipe(
  recipes: Recipes,
  mode: Mode,
  column: Column,
  machine: ReadonlyMap<string, Knob>,
  settings: Pick<PowerSection, "boost" | "epp" | "batteryMaxKhz"> = {},
): Recipe {
  const base = recipes[isMode(mode) ? mode : "balanced"][column];
  const values: Record<string, KnobValue> = {};
  for (const [name, value] of Object.entries(base.knobs)) {
    const knob = machine.get(name);
    if (knob && fits(knob, value)) values[name] = value;
  }
  const over = (name: string, value: KnobValue) => {
    const knob = machine.get(name);
    if (knob && fits(knob, value)) values[name] = value;
  };
  if (settings.boost === "off") over("boost", false);
  else if (settings.boost === "plugged") over("boost", column === "plugged");
  else if (settings.boost === "always") over("boost", true);
  if (settings.epp !== undefined && settings.epp !== "recipe") over("epp", settings.epp);
  // 0 is "no cap", whatever the knob's range says.
  if (settings.batteryMaxKhz !== undefined && machine.has("cpu-max-freq")) {
    if (column === "battery" && settings.batteryMaxKhz > 0) over("cpu-max-freq", settings.batteryMaxKhz);
    else values["cpu-max-freq"] = 0;
  }
  return { knobs: values };
}
