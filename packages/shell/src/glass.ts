/**
 * The shell's own panes of glass over IPC `glass` (decisions.md D710 to D719, D730 to D749): with
 * `DASHI_GLASS` set, the shell asks dashi-comp to frost what is behind some of its surfaces, each pane
 * at its Frost level, whose look (and Reduce Transparency's and battery saver's) is `glass-style`'s
 * (glass-style.ts). Off by default until the surfaces wear `material` and paint no fill (y4).
 * `DASHI_GLASS=1` frosts the launcher; a list names the surfaces (`launcher,dock,menubar`).
 */

import type { Compositor } from "./compositor/index.ts";
import type { GlassLevel } from "./glass-style.ts";

export type GlassSurface = "launcher" | "dock" | "menubar";

const SURFACES: readonly GlassSurface[] = ["launcher", "dock", "menubar"];

/** Each surface's Frost level (design.html DE-4): the bar and the Dock thin, the launcher regular. */
export const GLASS_LEVEL: Readonly<Record<GlassSurface, GlassLevel>> = { launcher: "regular", dock: "thin", menubar: "thin" };

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

  /** Its panes: `rects` in surface points, or the whole surface; corners `radius`. */
  set(rects: readonly GlassRect[] | "whole", radius: number): void {
    if (!this.on || !this.compositor) return;
    const round = (rect: GlassRect): GlassRect => ({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    const look = { radius, level: GLASS_LEVEL[this.surface] };
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
