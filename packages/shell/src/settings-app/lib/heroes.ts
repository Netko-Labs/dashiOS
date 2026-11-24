/**
 * The heroes' figures, pure (docs/design.html, "Settings"): what the
 * battery hero says, the display's facts and its shape, the scales the
 * Displays pane offers as pills, and the Control Center miniature's frames.
 * Every figure comes from something measured or reported; one that isn't
 * known is left out, never made up.
 */

import { SPACE } from "@dashi/ui";
import { formatWatts, statusLine } from "../../battery/panel-numbers.ts";
import type { Placed } from "../../control-center/layout.ts";
import { type Monitor, monitorLabel, refreshLabel, sizeLabel, uprightSize } from "../../display-config/monitors.ts";
import type { Battery } from "../../system/battery.ts";

export interface BatteryHero {
  percent: number;
  /** "On battery · 5 h 10 min left · 11.8 W": the time and the watts only where the battery says them. */
  status: string;
  /** The charge limit's tick; null without a limit under 100. */
  limit: number | null;
}

/** The battery hero's figures; null without a battery. */
export function batteryHero(battery: Battery | null, watts: number | null, limit: number | null): BatteryHero | null {
  if (!battery) return null;
  const flowing = battery.state === "charging" || battery.state === "discharging";
  const parts = [statusLine(battery, limit), ...(flowing && watts !== null && watts > 0 ? [formatWatts(Math.round(watts * 10) / 10)] : [])];
  return { percent: battery.percent, status: parts.join(" · "), limit: limit !== null && limit < 100 ? limit : null };
}

/** What the line's middle label says: the scale, and the limit when it is drawn. */
export const chargeScale = (limit: number | null): string => (limit !== null && limit < 100 ? `0–100% · limit ${limit}% dashed` : "0–100%");

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The names screens' shapes go by. */
const ASPECTS: Readonly<Record<string, string>> = {
  "8:5": "16:10",
  "16:9": "16:9",
  "3:2": "3:2",
  "4:3": "4:3",
  "5:4": "5:4",
  "64:27": "21:9",
  "43:18": "21:9",
  "12:5": "21:9",
};

/** "16:10" for 2880 × 1800; null for a shape that has no common name. */
export function aspectLabel(width: number, height: number): string | null {
  if (width <= 0 || height <= 0) return null;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const divisor = gcd(long, short);
  return ASPECTS[`${long / divisor}:${short / divisor}`] ?? null;
}

export interface DisplayHero {
  /** "Built-in", the monitor's model, or "Display" (`displayName`). */
  name: string;
  /**
   * What only the hero says, under the picture, each fact once (the title
   * names a lone display, the Resolution row its size, the Scale row what it
   * looks like): the name where several share the hero, the shape, and the
   * refresh rate where no Refresh rate row says it ("16:10 · 59.89 Hz").
   */
  caption: string;
  /** Everything at once, for the screen reader: "Built-in · 2880 × 1800 · 16:10". */
  label: string;
  /** The picture's size, at the screen's real shape, inside `box`. */
  shape: { width: number; height: number };
}

export interface HeroPlace {
  /** Several displays share the hero, so each picture carries its name. */
  several?: boolean;
  /** The cards have a Refresh rate row, which says the rate. */
  rateRow?: boolean;
  /** Every display, so two without a model are told apart ("Display 1", "Display 2"). */
  all?: readonly Monitor[];
}

/** A display without a make and model (no EDID): the compositor names it by its connector, which no person reads. */
const unnamed = (monitor: Monitor): boolean => !monitor.builtIn && monitorLabel(monitor) === monitor.name;

/**
 * A display by its plain name, never its connector (VO-11, SE-A28): "Built-in", its model, or "Display" (numbered
 * by connector order when several have no model).
 */
export function displayName(monitor: Monitor, all: readonly Monitor[] = [monitor]): string {
  if (monitor.builtIn) return "Built-in";
  if (!unnamed(monitor)) return monitorLabel(monitor);
  const nameless = all.filter(unnamed).map((each) => each.name);
  if (!nameless.includes(monitor.name)) nameless.push(monitor.name);
  if (nameless.length < 2) return "Display";
  return `Display ${nameless.sort().indexOf(monitor.name) + 1}`;
}

/** The display hero for a monitor: its name, the facts only it says, and its shape fitted in `box`. */
export function displayHero(monitor: Monitor, box: { width: number; height: number }, place: HeroPlace = {}): DisplayHero {
  const name = displayName(monitor, place.all);
  const size = uprightSize(monitor);
  const aspect = size ? aspectLabel(size.width, size.height) : null;
  const label = [name, ...(size ? [sizeLabel(size)] : ["Off"]), ...(aspect ? [aspect] : [])].join(" · ");
  const rate = monitor.mode && !place.rateRow ? refreshLabel(monitor.mode.refreshMhz) : null;
  const facts = [...(place.several ? [name] : []), ...(aspect ? [aspect] : []), ...(rate ? [rate] : [])];
  const ratio = size && size.height > 0 ? size.width / size.height : 16 / 10;
  const width = Math.min(box.width, Math.round(box.height * ratio));
  return { name, caption: facts.length > 0 ? facts.join(" · ") : name, label, shape: { width, height: Math.round(width / ratio) } };
}

/** The display the title names and the cards change: the one asked for while it is on, else the main one, else the first on. */
export function chosenMonitor(monitors: readonly Monitor[], asked: string | null): Monitor | null {
  const on = monitors.filter((monitor) => monitor.enabled && monitor.mode);
  return on.find((monitor) => monitor.name === asked) ?? on.find((monitor) => monitor.primary) ?? on[0] ?? null;
}

/** The scales shown as pills: the one in use and its neighbours, `count` in all; `more` when the list has others ("Other…"). */
export function scaleOffer(choices: readonly number[], current: number, count = 3): { shown: number[]; more: boolean } {
  if (choices.length <= count) return { shown: [...choices], more: false };
  const at = Math.max(
    choices.findIndex((scale) => Math.abs(scale - current) < 0.005),
    0,
  );
  const start = Math.min(Math.max(at - Math.floor(count / 2), 0), choices.length - count);
  return { shown: choices.slice(start, start + count), more: true };
}

/** The miniature of the panel: 300 wide, 10 in, tiles 7 apart, rows 44. */
export const MINIATURE = { width: 300, padding: SPACE.gap, tileGap: 7, row: 44, columns: 4 } as const;

const MINI_COLUMN = (MINIATURE.width - 2 * MINIATURE.padding - (MINIATURE.columns - 1) * MINIATURE.tileGap) / MINIATURE.columns;

/** Where a placed tile sits in the miniature, from its top left. */
export function miniatureFrame(tile: Pick<Placed, "col" | "row" | "cols" | "rows">): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.round(tile.col * (MINI_COLUMN + MINIATURE.tileGap)),
    top: tile.row * (MINIATURE.row + MINIATURE.tileGap),
    width: Math.round(tile.cols * MINI_COLUMN + (tile.cols - 1) * MINIATURE.tileGap),
    height: tile.rows * MINIATURE.row + (tile.rows - 1) * MINIATURE.tileGap,
  };
}

/** The miniature's height for the placed tiles, its padding included. */
export function miniatureHeight(placed: readonly Pick<Placed, "row" | "rows">[]): number {
  const rows = Math.max(0, ...placed.map((tile) => tile.row + tile.rows));
  return 2 * MINIATURE.padding + (rows === 0 ? 0 : rows * MINIATURE.row + (rows - 1) * MINIATURE.tileGap);
}

/** An applet's controls, as Settings › Control Center lists them: "Lid light · Fans · CPU", and how many. */
export function appletOffers(tiles: readonly { appletName: string; title: string }[]): Array<{ applet: string; titles: string[] }> {
  const byApplet = new Map<string, string[]>();
  for (const tile of tiles) byApplet.set(tile.appletName, [...(byApplet.get(tile.appletName) ?? []), tile.title]);
  return [...byApplet].map(([applet, titles]) => ({ applet, titles }));
}
