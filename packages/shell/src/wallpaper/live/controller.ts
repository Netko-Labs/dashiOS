/**
 * Live wallpapers, as policy. Bun decides what shows and when it stands
 * still; dashi-comp draws a shader or plays a video and obeys (IPC
 * `wallpaper`). Whatever it animates is paused with `wallpaper {paused}`
 * while no screen shows it: every screen covered by windows, the session
 * locked, the screens off, or (by default) the machine on battery
 * (pause.ts). The lock screen shows the still wallpaper.
 *
 * What it listens to: windows opening, closing, zooming, going full screen,
 * and `person-input` (a drag or a tile ends with the person's hand); a change
 * of screens; the lock; the screens blanking (idle.ts); the battery.
 * A burst of them is one look at the windows.
 */

import type { Compositor, CompositorEvent, CompositorWindow } from "../../compositor.ts";
import type { Battery } from "../../system/battery.ts";
import type { WallpaperChoice } from "../catalog.ts";
import type { WallpaperSync } from "../sync.ts";
import { type LiveChoice, resolveLive } from "./choice.ts";
import { type PauseReason, isCovered, parseScreenAreas, pauseReason, type ScreenArea } from "./pause.ts";

export interface LiveHost {
  request: Compositor["request"];
  windows(): Promise<CompositorWindow[]>;
  on(listener: (event: CompositorEvent) => void): () => void;
}

export interface Clock {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LiveOptions {
  compositor: LiveHost;
  sync: Pick<WallpaperSync, "apply" | "pause">;
  battery(): Battery | null;
  clock?: Clock;
  log?: (message: string) => void;
}

/** A burst of events is one look at the windows... */
const SETTLE_MS = 150;
/**
 * ...and one more a little later: an app takes its time to draw at a new
 * size (a zoom, a tile), and the compositor lists the frame it has now.
 */
const FOLLOW_UP_MS = 900;

export class LiveWallpaperController {
  private readonly clock: Clock;
  private readonly log: (message: string) => void;
  private live: LiveChoice | null = null;
  private screens: ScreenArea[] = [];
  private locked = false;
  private wasOnBattery = false;
  private screensOff = false;
  private timer: unknown = null;
  private followUp: unknown = null;
  private looks = 0;
  private stopListening: (() => void) | null = null;

  constructor(private readonly options: LiveOptions) {
    this.clock = options.clock ?? realClock;
    this.log = options.log ?? ((message) => console.error(`dashi-shell: ${message}`));
  }

  /** Follow the compositor; returns after the screens and the lock are known. */
  async start(): Promise<void> {
    this.stopListening = this.options.compositor.on((event) => this.heard(event));
    await this.loadScreens();
    try {
      const session = await this.options.compositor.request("session");
      this.locked = typeof session === "object" && session !== null && (session as { locked?: unknown }).locked === true;
    } catch {
      // An older compositor: not locked as far as we know; the `lock` event will say.
    }
    this.settle();
  }

  /** The choice the settings now hold: it goes to the compositor, and the pause follows it. */
  apply(choice: WallpaperChoice): void {
    this.live = resolveLive(choice);
    this.options.sync.apply(choice);
    this.settle();
  }

  /** The screens blanked or came back (idle.ts). */
  screensBlanked(blanked: boolean): void {
    if (this.screensOff === blanked) return;
    this.screensOff = blanked;
    this.schedule();
  }

  /** The system store changed (it also moves for volume and Wi-Fi): look only when the battery went on or off the charger. */
  powerChanged(): void {
    const onBattery = this.options.battery()?.state === "discharging";
    if (onBattery === this.wasOnBattery) return;
    this.wasOnBattery = onBattery;
    this.schedule();
  }

  /** Stop listening and looking; the compositor keeps what it was last told. */
  stop(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.cancelTimers();
  }

  private heard(event: CompositorEvent): void {
    switch (event.event) {
      case "lock":
        this.locked = event.locked;
        this.schedule();
        break;
      case "outputs-changed":
        void this.loadScreens().then(() => this.settle());
        break;
      case "window-opened":
      case "window-closed":
      case "zoom":
      case "fullscreen":
      case "person-input":
        this.schedule();
        break;
      default:
        break;
    }
  }

  private async loadScreens(): Promise<void> {
    try {
      this.screens = parseScreenAreas(await this.options.compositor.request("outputs"));
    } catch (error) {
      this.log(`could not list the screens for the wallpaper: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private cancelTimers(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    if (this.followUp !== null) this.clock.clearTimeout(this.followUp);
    this.timer = null;
    this.followUp = null;
  }

  private armFollowUp(): void {
    this.followUp = this.clock.setTimeout(() => {
      this.followUp = null;
      void this.look();
    }, FOLLOW_UP_MS);
  }

  /** A look at the windows, soon, and another after the apps have caught up: a burst of events is one of each. */
  private schedule(): void {
    this.cancelTimers();
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.look();
    }, SETTLE_MS);
    this.armFollowUp();
  }

  /** A look, now (after a choice or screens changed), and the follow-up. */
  private settle(): void {
    this.cancelTimers();
    void this.look();
    this.armFollowUp();
  }

  /** What pausing comes to for each screen right now; exposed for tests. */
  async look(): Promise<Record<string, PauseReason | null>> {
    const live = this.live;
    const reasons: Record<string, PauseReason | null> = {};
    // A still picture has nothing to pause.
    if (live === null || live.wallpaper.kind === "picture") return reasons;
    const look = ++this.looks;
    // A locked session answers `windows` with an error: nothing is covered, and the lock pauses anyway.
    const windows = this.locked ? [] : await this.options.compositor.windows().catch(() => [] as CompositorWindow[]);
    // A newer look (or a newer choice) already decided.
    if (look !== this.looks || live !== this.live) return reasons;
    const onBattery = this.options.battery()?.state === "discharging";
    this.wasOnBattery = onBattery;
    const base = { locked: this.locked, screensOff: this.screensOff, onBattery, pauseOnBattery: live.pauseOnBattery };
    for (const screen of this.screens) reasons[screen.name] = pauseReason({ ...base, covered: isCovered(screen, windows) });
    // One animation for every screen: it stands still when none shows it.
    const hidden = this.screens.length === 0 ? pauseReason({ ...base, covered: false }) !== null : Object.values(reasons).every((reason) => reason !== null);
    this.options.sync.pause(hidden);
    return reasons;
  }
}
