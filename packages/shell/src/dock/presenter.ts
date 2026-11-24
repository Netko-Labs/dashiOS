/**
 * Whether the Dock's surface exists, as a function of the Dock's settings
 * and, when it autohides, whether it is out. It is one surface on the primary
 * screen, the Dock or the taskbar, and it is there when the Dock is visible
 * and either does not autohide (with an exclusive zone, so windows stop above
 * it) or is out (without one, over the windows, sliding in and out). A layer
 * surface's options are fixed once it opens, so a new style or zone is a new
 * host. When the Dock is away nothing of the Dock is on the screen: the
 * windows are reported by the menu bar's host (menubars.ts), not by a strip
 * kept here, which would sit over a window's bottom resize edge.
 *
 * For an autohiding Dock it also claims the band along the screen's bottom
 * edge in the compositor (dock/lib/edges.ts): one pixel while the Dock is away,
 * the Dock's own height while it is out, so the pointer leaving the Dock is
 * heard too.
 *
 * The Dock follows the person (decisions.md D555): it lives on the main
 * display, and the pointer resting against the bottom edge of another
 * screen for `FOLLOW_MS` brings it there, as on a Mac. So while it is not
 * out, the one-pixel band is claimed along every screen's bottom edge (a
 * Dock that stays shown claims it too), and an edge on another screen moves
 * it before it comes out. It goes back to the main display when that
 * changes or its screen goes away.
 *
 * Nothing here knows Metal; start.tsx hands in the surfaces.
 */

import { DOCK, DOCK_HEIGHT, TASKBAR } from "../theme.ts";
import type { Autohide } from "./lib/autohide.ts";
import type { EdgeClaim } from "./lib/edges.ts";
import { DOCK_MOTION, type Slide } from "./lib/slide.tsx";
import type { DockSurface } from "./lib/surface.ts";
import type { DockPrefs } from "./prefs.ts";
import type { DockSettings, DockStyle } from "./settings.ts";

export interface ViewSpec {
  style: DockStyle;
  /** Windows stop at the Dock: it does not autohide. */
  exclusive: boolean;
}

/** The Dock surface wanted now, or null for none. */
export function wantedView(settings: DockSettings, revealed: boolean): ViewSpec | null {
  if (!settings.visible) return null;
  if (settings.autohide && !revealed) return null;
  return { style: settings.style, exclusive: !settings.autohide };
}

/** The height of the area a view takes along the screen's bottom edge: what the pointer must leave for it to hide. */
export const viewHeight = (style: DockStyle): number => (style === "taskbar" ? TASKBAR.height : DOCK_HEIGHT + DOCK.margin);

/**
 * How much of the screen's bottom the Dock takes from everything else right
 * now: its zone when it is shown to stay, nothing when it is hidden or
 * autohides (it then lies over windows only while it is out). What a panel
 * that stops above the Dock (the notification center) leaves free.
 */
export function bottomInset(settings: DockSettings): number {
  return settings.visible && !settings.autohide ? viewHeight(settings.style) : 0;
}

/** The band to watch along the bottom edge, in px: none unless the Dock autohides. */
export function bandFor(settings: DockSettings, revealed: boolean): number {
  if (!settings.visible || !settings.autohide) return 0;
  return revealed ? viewHeight(settings.style) : EDGE_BAND;
}

/** Where the pointer must be to bring an autohidden Dock: against the edge. */
export const EDGE_BAND = 1;

/** How long the pointer rests against another screen's bottom edge before the Dock moves there (a brush past does nothing). */
export const FOLLOW_MS = 250;

/** The variant name of a view (surface.ts): what its host opens as. */
export const variantOf = (spec: ViewSpec): string => `${spec.style}:${spec.exclusive ? "zone" : "float"}`;

/** Reads a variant name back. Unknown names read as the floating Dock. */
export function specOf(variant: string): ViewSpec {
  const [style, zone] = variant.split(":");
  return { style: style === "taskbar" ? "taskbar" : "dock", exclusive: zone === "zone" };
}

export interface PresenterDeps {
  prefs: Pick<DockPrefs, "snapshot" | "subscribe">;
  autohide: Autohide;
  slide: Slide;
  view: Pick<DockSurface, "show" | "hide" | "close" | "shown" | "variant" | "output">;
  /** Where the pointer is along the bottom edge; null without a compositor, where autohide cannot work and the Dock stays. */
  edges: EdgeClaim | null;
  /** The screen under the pointer, asked when it reaches a bottom edge; without it the Dock stays on the main display. */
  pointerScreen?: () => Promise<string | undefined>;
  /** Runs `fn` later; returns the way to cancel it. */
  later?(fn: () => void, ms: number): () => void;
}

const defer = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export class DockPresenter {
  /** The main display: the Dock's home. */
  private home: string | undefined;
  /** Where it is now: home, or the screen it followed the person to. */
  private output: string | undefined;
  private cancelFollow: (() => void) | null = null;
  private placed = false;
  private slideTarget: 0 | 1 = 0;
  /** The band last claimed, and on which screen. */
  private claimed = { band: 0, output: undefined as string | undefined };
  private cancelHide: (() => void) | null = null;
  private stops: Array<() => void> = [];
  private readonly later: NonNullable<PresenterDeps["later"]>;

  constructor(private readonly deps: PresenterDeps) {
    this.later = deps.later ?? defer;
  }

  /** Follow the settings and the pointer. Nothing shows until `place`. */
  start(): void {
    const { prefs, autohide } = this.deps;
    this.stops.push(
      prefs.subscribe(() => this.update()),
      autohide.subscribe(() => this.update()),
    );
  }

  /**
   * The Dock's home is `home` (the main display; wherever the compositor
   * puts it when undefined). It goes there when that changes, at first, or
   * when the screen it followed the person to is not among `screens`.
   */
  place(home: string | undefined, screens?: readonly string[]): void {
    const gone = this.output !== undefined && screens !== undefined && !screens.includes(this.output);
    if (!this.placed || home !== this.home || gone) {
      this.home = home;
      this.output = home;
    }
    this.placed = true;
    this.update();
  }

  /** The screen it is on now. */
  get screen(): string | undefined {
    return this.output;
  }

  /** The pointer entered or left the claimed band (IPC `edge`): on another screen's edge, the Dock follows it there first. */
  edge(inside: boolean): void {
    const { autohide, pointerScreen } = this.deps;
    this.cancelFollow?.();
    this.cancelFollow = null;
    if (!inside || !pointerScreen) {
      autohide.edge(inside);
      return;
    }
    void pointerScreen().then((screen) => {
      if (screen === undefined || screen === this.output) {
        autohide.edge(true);
        return;
      }
      this.cancelFollow = this.later(() => {
        this.cancelFollow = null;
        this.output = screen;
        this.update();
        autohide.edge(true);
      }, FOLLOW_MS);
    });
  }

  close(): void {
    for (const stop of this.stops) stop();
    this.stops = [];
    this.cancelHide?.();
    this.cancelHide = null;
    this.cancelFollow?.();
    this.cancelFollow = null;
    if (this.claimed.band > 0) this.claim(0);
    this.deps.view.close();
  }

  /** Tell the compositor which band to watch, when that changed: every screen's edge for the one-pixel band when the Dock can follow. */
  private claim(band: number): void {
    const { edges } = this.deps;
    const output = band === EDGE_BAND && this.deps.pointerScreen ? undefined : this.output;
    if (!edges || (this.claimed.band === band && (band === 0 || this.claimed.output === output))) return;
    this.claimed = { band, output };
    void edges.claim(band, output).then((inside) => {
      // The answer is where the pointer is now; a newer claim has its own.
      if (this.claimed.band === band && this.claimed.output === output) this.edge(inside);
    });
  }

  private update(): void {
    if (!this.placed) return;
    const { prefs, autohide, slide, view } = this.deps;
    // Without a way to hear the pointer leave, a Dock that hides could never come back.
    const settings = { ...prefs.snapshot, autohide: prefs.snapshot.autohide && this.deps.edges !== null };
    autohide.setEnabled(settings.autohide);
    // A Dock that stays shown still hears another screen's edge, to follow the person there.
    const band = bandFor(settings, autohide.revealed);
    this.claim(band === 0 && settings.visible && this.deps.pointerScreen ? EDGE_BAND : band);
    const spec = wantedView(settings, autohide.revealed);
    if (spec) {
      this.cancelHide?.();
      this.cancelHide = null;
      const variant = variantOf(spec);
      // A new host (at login, turned on, another style, another screen, an autohidden Dock coming
      // out) makes its entrance once it has painted (the view calls `slide.ready()`); one already
      // there that was going out turns around.
      const fresh = !view.shown || view.variant !== variant || view.output !== this.output;
      if (fresh) slide.armEntrance();
      else if (this.slideTarget !== 0) slide.show();
      this.slideTarget = 0;
      view.show(this.output, variant);
      return;
    }
    if (!view.shown) return;
    if (settings.visible && settings.autohide) {
      // Drop out of view, then end the host (it was kept to show the motion).
      if (this.cancelHide) return;
      this.slideTarget = 1;
      slide.hide();
      this.cancelHide = this.later(() => {
        this.cancelHide = null;
        view.hide();
      }, DOCK_MOTION.hideMs + 40);
      return;
    }
    this.cancelHide?.();
    this.cancelHide = null;
    view.hide();
  }
}
