/**
 * Frosted glass, a spike (docs/decisions.md D710 to D719): with `DASHI_GLASS` set, the shell asks
 * dashi-comp to blur what is behind some of its surfaces (IPC `glass`), and those surfaces wear a
 * translucent fill over it. Off by default: it ships once the owner picks a direction.
 * `DASHI_GLASS=1` frosts the launcher; a list names the surfaces (`launcher,dock,menubar`).
 * `DASHI_GLASS_XRAY=1` shows only the wallpaper through them (the cheap kind: blurred once).
 * The compositor blurs; whether there is glass, where, and how it looks is decided here.
 */

import type { Compositor } from "./compositor/index.ts";

export type GlassSurface = "launcher" | "dock" | "menubar";

const SURFACES: readonly GlassSurface[] = ["launcher", "dock", "menubar"];

/**
 * The glass's look for the spike, the same on every surface: `blur` about CSS's `blur()` in points,
 * the colours behind lifted by `saturation`, and a fine grain so a smooth blur doesn't band.
 */
export const GLASS_LOOK = { blur: 30, saturation: 1.7, noise: 0.025 } as const;

/** The surfaces `value` (`DASHI_GLASS`) names: "1" the launcher, else a comma list. */
export function glassSurfaces(value: string | undefined): ReadonlySet<GlassSurface> {
  if (!value || value === "0") return new Set();
  if (value === "1") return new Set(["launcher"]);
  const named = value.split(",").map((each) => each.trim());
  return new Set(SURFACES.filter((surface) => named.includes(surface)));
}

export interface GlassRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A tint the compositor lays over the blur, raised where `ink` (the surface's faintest words) needs it. */
export interface GlassTint {
  tint: string;
  ink: string;
}

/** The contrast the faintest words keep over the glass (design.html CO-6). */
const FLOOR_RATIO = 4.5;

/** One surface's panes of glass, sent to the compositor when they change. */
export class GlassPanes {
  private sent = "";

  constructor(
    private readonly compositor: Pick<Compositor, "glass"> | null,
    private readonly surface: GlassSurface,
    private readonly namespace: string,
    on: ReadonlySet<GlassSurface> = glassSurfaces(process.env.DASHI_GLASS),
  ) {
    this.on = on.has(surface);
  }

  /** Whether this surface is glass: it wears the translucent fill then. */
  readonly on: boolean;

  /** Its panes: `rects` in surface points, or the whole surface; corners `radius`; the compositor's tint, if any. */
  set(rects: readonly GlassRect[] | "whole", radius: number, tint?: GlassTint): void {
    if (!this.on || !this.compositor) return;
    const round = (rect: GlassRect): GlassRect => ({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    const tinted = tint ? { tint: tint.tint, floor: { ink: tint.ink, ratio: FLOOR_RATIO } } : {};
    const look = { radius, ...GLASS_LOOK, ...tinted, ...(process.env.DASHI_GLASS_XRAY === "1" ? { xray: true } : {}) };
    const panes = rects === "whole" ? [look] : rects.map((rect) => ({ rect: round(rect), ...look }));
    const key = JSON.stringify(panes);
    if (key === this.sent) return;
    this.sent = key;
    this.compositor
      .glass({ namespace: this.namespace, panes })
      .then(({ frosted }) => {
        if (!frosted) console.error(`dashi-shell: no glass behind the ${this.surface}: this compositor does not frost`);
      })
      .catch((error) => console.error(`dashi-shell: glass behind the ${this.surface}:`, error instanceof Error ? error.message : error));
  }
}
