/**
 * What a tree paints with when it sits on glass (design.html GL-1, GL-5, CO-6, CO-9; decisions.md D770 to
 * D772). A surface that wears a level (`Frosted`, frosted.tsx) says so to everything under it through
 * `OnGlassContext`, and the palettes the kit reads (`useColors`, `useControlColors`, `useSurface`) turn
 * into their glass twins there:
 * - words and glyphs are the vibrant inks (`GLASS.ink`): a grey leaning a breath to the backdrop's hue,
 *   from the tone the compositor sends, neutral until it does (GL-1); a link is primary ink, never the accent;
 * - a control's edge is the glass control edge (`GLASS.edge`, CO-6), a quiet fill is white laid on the glass
 *   (`GLASS.fill`), and a selection is the accent at 22 % under primary words (CO-9);
 * - five coloured inks take their step (`GLASS.inks`, GL-5).
 * A window without focus turns its selection neutral (CO-9): `WindowFocusContext`, which `AppWindow` sets.
 * Pure: the palettes are computed from their bases and cached.
 */

import { createContext } from "react";
import type { ControlPalette } from "./controls.ts";
import { GLASS, type GlassLevel } from "./glass.ts";
import { INK_NAMES, type InkMode, type InkTokens } from "./inks.ts";
import { hexToOklch, oklchToHex } from "./lib/oklch.ts";
import { lightColors, type Palette } from "./palette.ts";
import type { Surface } from "./surface.ts";

/** Where a tree sits on glass: its level and the backdrop's tone (`#rrggbb`), null until the compositor says. */
export interface OnGlass {
  level: GlassLevel;
  tone: string | null;
}

/** The glass the tree below sits on, or null: a window's ground. `Frosted` provides it. */
export const OnGlassContext = createContext<OnGlass | null>(null);

/** Whether the window the tree is drawn in has focus (CO-9: without it a selection is neutral). `AppWindow` provides it. */
export const WindowFocusContext = createContext(true);

/** The ink and paper glass is measured against: words in Light, white in Dark. */
const INK = lightColors.text;
const WHITE = "#ffffff";

/** `#rrggbb` (or `#rrggbbaa`, whose α is dropped) at α `alpha`, 0 to 1. */
export function withAlpha(hex: string, alpha: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${hex.slice(0, 7)}${byte.toString(16).padStart(2, "0")}`;
}

/**
 * The vibrant inks (GL-1): `GLASS.ink`'s lightness, the backdrop's hue, and its chroma up to the token's
 * (a grey backdrop gives grey words). Neutral until there is a tone.
 */
export function vibrantInks(dark: boolean, tone: string | null): { primary: string; secondary: string } {
  const spec = GLASS.ink[dark ? "dark" : "light"];
  const backdrop = tone === null ? null : hexToOklch(tone);
  const lean = (ink: { L: number; C: number }): string => oklchToHex({ L: ink.L, C: backdrop === null ? 0 : Math.min(ink.C, backdrop.C), H: backdrop?.H ?? 0 });
  return { primary: lean(spec.primary), secondary: lean(spec.secondary) };
}

/** The glass control edge (CO-6, D766): ink at 56 % in Light, white at 44 % in Dark. */
export const glassEdge = (dark: boolean): string => (dark ? withAlpha(WHITE, GLASS.edge.dark) : withAlpha(INK, GLASS.edge.light));

/** A fill inside glass (a tile, a field, a quiet button, a bubble): white laid on the glass. */
export const glassFill = (dark: boolean, step = 0): string => withAlpha(WHITE, GLASS.fill[dark ? "dark" : "light"] + step);

/** A chosen segment on glass, raised on paper, never the accent (frost-objects board 30). */
const RAISED = { light: "#ffffff", dark: "#4a4a50" } as const;

/** What a chosen segment is raised on, on glass. */
export const glassRaised = (dark: boolean): string => RAISED[dark ? "dark" : "light"];

/** How much more white a fill takes under the pointer. */
const FILL_HOVER = 0.12;

/** Ume on glass (GL-5): Light's words one step darker, Dark's on a fill one step lighter. */
const umeOnGlass = (dark: boolean): string => (dark ? GLASS.inks.dark.umeOnFill : GLASS.inks.light.ume);

/** A selection, focused or not (CO-9): the accent's wash under primary words, or ink at 10 % with an ink bar at 55 %. */
function selectionOf(base: Palette, ink: string, glass: boolean, focused: boolean): Partial<Palette> {
  if (!focused) {
    return {
      selectionWash: withAlpha(ink, GLASS.selection.unfocusedWash),
      selectionBar: withAlpha(ink, GLASS.selection.unfocusedBar),
      onSelection: ink,
    };
  }
  return glass ? { selectionWash: withAlpha(base.selection, GLASS.selection.wash), onSelection: ink } : {};
}

const painted = new WeakMap<Palette, Map<string, Palette>>();

/** The palette `base` (Light or Dark) turns into on `glass` (null: a window's ground) in a window `focused` or not. */
export function paintedPalette(base: Palette, dark: boolean, glass: OnGlass | null, focused: boolean): Palette {
  if (glass === null && focused) return base;
  const key = `${dark}|${glass?.level ?? ""}|${glass?.tone ?? ""}|${focused}`;
  let byKey = painted.get(base);
  if (!byKey) {
    byKey = new Map();
    painted.set(base, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit;
  const palette = glass === null ? { ...base, ...selectionOf(base, base.text, false, false) } : onGlassPalette(base, dark, glass, focused);
  if (byKey.size > 32) byKey.clear();
  byKey.set(key, palette);
  return palette;
}

function onGlassPalette(base: Palette, dark: boolean, glass: OnGlass, focused: boolean): Palette {
  const { primary, secondary } = vibrantInks(dark, glass.tone);
  const edge = glassEdge(dark);
  const ume = umeOnGlass(dark);
  const microphone = dark ? {} : { microphone: GLASS.inks.light.microphone, microphoneWash: withAlpha(base.microphoneWash, GLASS.inks.microphoneWash) };
  return {
    ...base,
    text: primary,
    textMuted: secondary,
    textDisabled: withAlpha(primary, GLASS_DISABLED),
    dot: primary,
    controlEdge: edge,
    checkbox: edge,
    button: glassFill(dark),
    tile: glassFill(dark),
    tileHover: glassFill(dark, FILL_HOVER),
    ume,
    critical: ume,
    criticalInk: ume,
    batteryLow: ume,
    // A link on glass is primary ink, never the accent (GL-1).
    accentInk: primary,
    ...microphone,
    ...selectionOf(base, primary, true, focused),
  };
}

/** Disabled words on glass stay at 40 % (GL-1). */
const GLASS_DISABLED = 0.4;

/** The panel look on glass: words the vibrant inks, an off tile or row a fill, every outline the glass edge (CC-1, CO-6). */
export function glassControls(base: ControlPalette, dark: boolean, glass: OnGlass): ControlPalette {
  const { primary, secondary } = vibrantInks(dark, glass.tone);
  return { ...base, off: glassFill(dark), offInk: primary, text: primary, muted: secondary, chip: glassFill(dark), edge: glassEdge(dark) };
}

/** A window's grounds on glass: a field, a card and a stripe are fills (words on a fill are checked on it, DE-4). */
export function glassSurface(base: Surface, dark: boolean): Surface {
  const fill = glassFill(dark);
  return { ...base, field: fill, card: fill, stripe: glassFill(dark, -GLASS.fill[dark ? "dark" : "light"] / 2) };
}

/**
 * A pick in ink, never the accent (CO-9's neutral look; a place the accent never paints, H23: the widget
 * gallery's chosen kind): its wash, ink at 10 %, and its 3-point bar, ink at 55 %.
 */
export function inkPick(ink: string): { wash: string; bar: string } {
  return { wash: withAlpha(ink, GLASS.selection.unfocusedWash), bar: withAlpha(ink, GLASS.selection.unfocusedBar) };
}

/** The Inks on glass (GL-5): in Light, matcha and wakame one step darker; the rest as on paper. */
export function glassInkTokens(tokens: InkTokens): InkTokens {
  if (tokens.mode !== ("light" satisfies InkMode)) return tokens;
  const ink = { ...tokens.ink, matcha: GLASS.inks.light.matcha, wakame: GLASS.inks.light.wakame };
  return INK_NAMES.every((name) => ink[name] === tokens.ink[name]) ? tokens : { ...tokens, ink };
}
