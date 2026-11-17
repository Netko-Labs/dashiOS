/**
 * The accent the person picks (Settings › Appearance; settings.json
 * `appearance.accent`; dashi-0.9.0-design/accent/README.md). The pick is a
 * seed, not a paint: the guard (lib/guard.ts) draws Dashi's "on or chosen"
 * tokens from it for Light and for Dark. Kombu, Dashi's own, is no setting
 * and keeps palette.ts's hand-set values byte for byte.
 *
 * The accent paints what is on or chosen: selection, switches, ticks,
 * pills, sliders, progress, links, menu highlights, text selection, the
 * active window's ring. Never the tally, a widget's ink, the agents'
 * purple, the microphone, errors, buttons (ink) or the Dock's dot.
 */

import { hexToOklch } from "../lib/oklch.ts";
import { derive, FIXED, type GuardOptions, hueGap, type Mode, type Move, RULE, steps } from "./lib/guard.ts";

export interface AccentPreset {
  id: string;
  name: string;
  seed: string;
}

/** Dashi's own seed: today's kombu. */
export const KOMBU_SEED = "#357A64";

/** In the order Settings shows them; Kombu first. No purple and no orange: both bands have a job. */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: "kombu", name: "Kombu", seed: KOMBU_SEED },
  { id: "ai", name: "Ai", seed: "#036DB0" },
  { id: "momo", name: "Momo", seed: "#DA4482" },
  { id: "wasabi", name: "Wasabi", seed: "#9BD12E" },
  { id: "kuri", name: "Kuri", seed: "#7B5B46" },
  { id: "nori", name: "Nori", seed: "#2B2B2E" },
];

export const ACCENT_PRESET_IDS: readonly string[] = ACCENT_PRESETS.map((preset) => preset.id);

/** What settings.json keeps: a preset, a colour, or the wallpaper's. No key is Kombu. */
export type AccentChoice = { preset: string } | { custom: string } | { wallpaper: true };

const HEX = /^#[0-9a-fA-F]{6}$/;

export const isAccentHex = (value: unknown): value is string => typeof value === "string" && HEX.test(value);

export function isAccentChoice(value: unknown): value is AccentChoice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const [key] = keys;
  const entry: unknown = Object.values(value)[0];
  if (key === "preset") return typeof entry === "string" && ACCENT_PRESET_IDS.includes(entry);
  if (key === "custom") return isAccentHex(entry);
  return key === "wallpaper" && entry === true;
}

/** The seed a choice names; the wallpaper's is found by the shell, so it is `wallpaperSeed` here (null: not known yet, Kombu). */
export function seedOf(choice: AccentChoice | undefined, wallpaperSeed: string | null = null): string {
  if (!choice) return KOMBU_SEED;
  if ("preset" in choice) return ACCENT_PRESETS.find((preset) => preset.id === choice.preset)?.seed ?? KOMBU_SEED;
  if ("custom" in choice) return choice.custom.toUpperCase();
  return wallpaperSeed ?? KOMBU_SEED;
}

/** How the row names the pick: a preset's name, a colour's hex, or "Wallpaper". */
export function choiceName(choice: AccentChoice | undefined): string {
  if (!choice) return "Kombu";
  if ("preset" in choice) return ACCENT_PRESETS.find((preset) => preset.id === choice.preset)?.name ?? "Kombu";
  if ("custom" in choice) return choice.custom.toUpperCase();
  return "Wallpaper";
}

export const isKombu = (seed: string | null | undefined): boolean => !seed || seed.toUpperCase() === KOMBU_SEED;

/** The palette keys the accent owns (palette.ts), drawn for one seed in one mode. */
export interface AccentTokens {
  selection: string;
  selectionHover: string;
  selectionPressed: string;
  selectionWash: string;
  textSelection: string;
  selectionBar: string;
  accentInk: string;
  onAccent: string;
}

/** What one seed draws in a mode, with why it moved: the picker's dots and the sheet's line read it. */
export interface AccentDrawing {
  seed: string;
  fill: string;
  on: string;
  ink: string;
  moved: readonly Move[];
  tokens: AccentTokens;
}

const drawings = new Map<string, AccentDrawing>();

/** The guarded tokens for `seed` in Light or Dark (cached: a repaint asks again and again). */
export function drawAccent(seed: string, dark: boolean, options: GuardOptions = {}): AccentDrawing {
  const key = `${seed.toUpperCase()}|${dark}|${options.hc === true}|${options.agent ?? ""}`;
  const known = drawings.get(key);
  if (known) return known;
  const mode: Mode = dark ? "dark" : "light";
  const drawn = derive(seed, mode, options);
  const [hover, pressed] = steps(drawn.fill, drawn.on, options.hc);
  const drawing: AccentDrawing = {
    seed: drawn.seed,
    fill: drawn.fill,
    on: drawn.on,
    ink: drawn.ink,
    moved: drawn.moved,
    tokens: {
      selection: drawn.fill,
      selectionHover: hover,
      selectionPressed: pressed,
      selectionWash: drawn.wash,
      textSelection: drawn.text,
      selectionBar: drawn.fill,
      accentInk: drawn.ink,
      onAccent: drawn.on,
    },
  };
  if (drawings.size > 256) drawings.clear();
  drawings.set(key, drawing);
  return drawing;
}

/** The one line under the row when the guard moved a pick; empty when it drew it as picked. */
export function accentSentence(seed: string, dark: boolean): string {
  if (isKombu(seed)) return "";
  const { moved, seed: drawn } = drawAccent(seed, dark);
  if (moved.includes("signal")) return "Orange is kept for the tally and the microphone, so yours is drawn quieter.";
  if (moved.includes("agent")) return `Purple is the agents' and the keyboard's, so yours is moved toward ${hexToOklch(drawn).H > 288 ? "pink" : "blue"}.`;
  if (moved.includes("contrast")) return `${dark ? "Drawn lighter on Dark" : "Drawn deeper on Light"} so words and switches stay readable.`;
  return "";
}

const SHISO_HUE = hexToOklch(FIXED.shiso.light).H;

/** Whether a loud colour of this hue would be moved by the guard (the tally's band, or near the agents' purple): the picker marks these. */
export function isGuardedHue(hex: string): boolean {
  const { H } = hexToOklch(hex);
  return (H >= RULE.signal[0] && H <= RULE.signal[1]) || hueGap(H, SHISO_HUE) < RULE.agentGap;
}
