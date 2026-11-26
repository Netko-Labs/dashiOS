/**
 * How glass looks and where it gives way (design.html "Glass", GL-1 to GL-3; decisions.md D730 to
 * D749): the shell decides, the compositor draws. Frost's numbers come from `@dashi/ui`'s `GLASS` for
 * the mode the person is in, and go to dashi-comp as `glass-style` whenever the mode or a fallback
 * changes:
 * - Reduce Transparency (Settings › Appearance, `appearance.reduceTransparency`): every level is its
 *   solid twin, rims and hairlines kept (GL-3);
 * - battery saver (the low-power mode): the wallpaper only, blurred once and kept (x-ray; D723), while
 *   Settings › Battery › Lighter glass on battery saver is on (`appearance.lighterGlassOnSaver`, D729);
 * - Tint glass with the wallpaper (`appearance.tintGlass`, GL-4) off: every level's saturation is 1;
 * - a GPU that can't frost (`{frosted: false}`): the compositor draws no glass, and clients paint their
 *   own fills (dashi_glass_v1 `drawing(none)`); `frosted` says so to the shell's own surfaces.
 * Other apps get glass too unless the person turns it off (`appearance.glassForApps`, D731); the
 * shell's own processes always do (`glass-clients`).
 */

import { GLASS, oklchToHex } from "@dashi/ui";
import type { Compositor } from "./compositor/index.ts";

export type GlassMode = "frosted" | "xray" | "solid";

/** Frost's four materials (`GLASS.levels`). */
export type GlassLevel = keyof typeof GLASS.levels;

/** What decides how glass is drawn. */
export interface GlassInputs {
  dark: boolean;
  reduceTransparency: boolean;
  batterySaver: boolean;
  /** Battery saver turns glass to the wallpaper only (on by default). */
  lighterOnSaver: boolean;
  /** The wallpaper's colour comes through by saturation (on by default); off, saturation 1. */
  tintGlass: boolean;
}

type Level = { blur: number; saturation: number; tint: string; solid?: string; reach?: number };

/** The `glass-style` params (docs/compositor-ipc.md). */
export interface GlassStyle {
  mode: GlassMode;
  levels: Record<GlassLevel | "veil", Level>;
  grain: number;
  rim: { width: number; top: string; middle: string; bottom: string };
  hairline: { width: number; color: string };
  floor: { ink: string; ratio: number };
  depth: number;
  apps: GlassLevel;
}

const WHITE = oklchToHex({ L: 1, C: 0, H: 0 });
const BLACK = oklchToHex({ L: 0, C: 0, H: 0 });
/** The level an app's own blur region borrows its blur from (no tint: the app tints itself; D732). */
const APPS_LEVEL: GlassLevel = "regular";

/** `#RRGGBB` at α `alpha` (0 to 1), as `#RRGGBBAA`. */
export function withAlpha(hex: string, alpha: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${hex.slice(0, 7)}${byte.toString(16).padStart(2, "0").toUpperCase()}`;
}

/** How glass is drawn: Reduce Transparency wins (solid), then battery saver (wallpaper only, unless the person said not to). */
export function glassMode({ reduceTransparency, batterySaver, lighterOnSaver }: Omit<GlassInputs, "dark" | "tintGlass">): GlassMode {
  if (reduceTransparency) return "solid";
  return batterySaver && lighterOnSaver ? "xray" : "frosted";
}

/** No saturation lift: the wallpaper's colour no longer comes through (GL-4). */
const UNTINTED = 1;

/** Frost's numbers for `inputs`' mode, as the compositor takes them. */
export function glassStyle(inputs: GlassInputs): GlassStyle {
  const tone = inputs.dark ? "dark" : "light";
  const level = (name: GlassLevel): Level => {
    const material = GLASS.levels[name];
    const look = material[tone];
    const saturation = inputs.tintGlass ? material.saturation : UNTINTED;
    return { blur: material.blur, saturation, tint: withAlpha(look.tint, look.least), solid: look.solid };
  };
  const veil = GLASS.veil;
  const rim = GLASS.rim[tone];
  // The floor's ink: the weakest words on glass, the vibrant secondary, neutral (its hue barely moves its luminance).
  const ink = oklchToHex({ ...GLASS.ink[tone].secondary, C: 0, H: 0 });
  return {
    mode: glassMode(inputs),
    levels: {
      thin: level("thin"),
      regular: level("regular"),
      thick: level("thick"),
      paper: level("paper"),
      veil: {
        blur: veil.blur,
        saturation: inputs.tintGlass ? veil.saturation : UNTINTED,
        tint: withAlpha(veil[tone].tint, veil[tone].least),
        reach: veil.floorReach,
      },
    },
    grain: GLASS.grain.amount,
    rim: { width: GLASS.rim.width, top: withAlpha(WHITE, rim.top), middle: withAlpha(WHITE, rim.middle), bottom: withAlpha(WHITE, rim.bottom) },
    hairline: { width: GLASS.hairline.width, color: withAlpha(BLACK, GLASS.hairline[tone]) },
    floor: { ink, ratio: GLASS.floor.ratio + GLASS.floor.margin },
    depth: GLASS.depth.layers,
    apps: APPS_LEVEL,
  };
}

/** Sends `glass-style` and `glass-clients` when what they say changes; knows whether the compositor frosts. */
export class GlassSync {
  /** Nothing is sent before Dark Mode is known (a first style in the wrong mode would flash). */
  private dark: boolean | null = null;
  private inputs: Omit<GlassInputs, "dark"> = { reduceTransparency: false, batterySaver: false, lighterOnSaver: true, tintGlass: true };
  private sentStyle = "";
  private sentClients = "";
  /** Whether the compositor frosts (null until it answered): false, the shell's own glass paints its fill. */
  frosted: boolean | null = null;

  constructor(private readonly compositor: Pick<Compositor, "glassStyle" | "glassClients">) {}

  /** Some of the inputs changed. */
  set({ dark, ...inputs }: Partial<GlassInputs>): void {
    this.inputs = { ...this.inputs, ...inputs };
    if (dark !== undefined) this.dark = dark;
    if (this.dark === null) return;
    const style = glassStyle({ ...this.inputs, dark: this.dark });
    const key = JSON.stringify(style);
    if (key === this.sentStyle) return;
    this.sentStyle = key;
    this.compositor
      .glassStyle(style)
      .then(({ frosted }) => {
        if (frosted !== this.frosted && !frosted) console.error("dashi-shell: glass: this compositor does not frost; surfaces keep their fills");
        this.frosted = frosted;
      })
      .catch((error) => console.error("dashi-shell: glass keeps its last look:", error instanceof Error ? error.message : error));
  }

  /** Whether other apps get glass (the shell's own processes always do). */
  setApps(others: boolean, deny: readonly string[] = []): void {
    const params = { others, deny: [...deny] };
    const key = JSON.stringify(params);
    if (key === this.sentClients) return;
    this.sentClients = key;
    this.compositor.glassClients(params).catch((error) => console.error("dashi-shell: apps' glass unchanged:", error instanceof Error ? error.message : error));
  }
}
