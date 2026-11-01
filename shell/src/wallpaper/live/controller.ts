/**
 * Live wallpapers, as policy. Bun decides what runs and when it stands
 * still; dashi-comp draws and obeys (IPC `wallpaper`):
 *
 *   - a Dashi shader is the compositor's own; it is paused with
 *     `wallpaper {paused}` while no screen shows it;
 *   - a video or Wallpaper Engine item is a linux-wallpaperengine process
 *     per screen (supervisor.ts), stopped with SIGSTOP while its screen is
 *     covered, and everything is stopped while the session is locked, the
 *     screens are off, or (by default) the machine is on battery
 *     (pause.ts). The lock screen shows the still wallpaper.
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
import { type PauseReason, isCovered, parseScreenAreas, pauseReason, type ScreenArea } from "./pause.ts";
import { type Plan, planWallpaper, type World } from "./plan.ts";
import { rendererArgv } from "./renderer.ts";
import { type Clock, realClock, type Spawner, Supervisor } from "./supervisor.ts";

export interface LiveHost {
  request: Compositor["request"];
  windows(): Promise<CompositorWindow[]>;
  on(listener: (event: CompositorEvent) => void): () => void;
}

export interface LiveOptions {
  compositor: LiveHost;
  sync: Pick<WallpaperSync, "apply" | "pause">;
  /** Reads the Workshop and the renderer fresh, each time a choice is applied. */
  world(): World;
  spawn: Spawner;
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
  private choice: WallpaperChoice | null = null;
  private plan: Plan | null = null;
  private screens: ScreenArea[] = [];
  private locked = false;
  private wasOnBattery = false;
  private screensOff = false;
  private readonly renderers = new Map<string, Supervisor>();
  private rendererKey = "";
  private timer: unknown = null;
  private followUp: unknown = null;
  private looks = 0;
  private stopListening: (() => void) | null = null;
  /** Serializes applying a choice and changing screens, which start and stop processes. */
  private queue: Promise<unknown> = Promise.resolve();

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
    this.queue = this.queue.then(() => this.reconcile());
    await this.queue;
    this.settle();
  }

  /** The choice the settings now hold. */
  apply(choice: WallpaperChoice): Promise<void> {
    this.choice = choice;
    this.queue = this.queue.then(async () => {
      this.plan = planWallpaper(choice, this.options.world());
      if (this.plan.note !== null) this.log(this.plan.note);
      this.options.sync.apply(this.plan.sync);
      await this.reconcile();
      this.settle();
    });
    return this.queue as Promise<void>;
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

  /** Stop everything, and wait until the processes are gone. */
  async stop(): Promise<void> {
    this.stopListening?.();
    this.stopListening = null;
    this.cancelTimers();
    await this.queue.catch(() => {});
    await Promise.all([...this.renderers.values()].map((renderer) => renderer.stop()));
    this.renderers.clear();
    this.rendererKey = "";
  }

  /** For the shell's exit, which cannot wait: nothing may outlive it. */
  killNow(): void {
    this.stopListening?.();
    for (const renderer of this.renderers.values()) renderer.killNow();
  }

  /** What each screen's renderer is doing, for tests and the log. */
  states(): Record<string, string> {
    return Object.fromEntries([...this.renderers].map(([name, renderer]) => [name, renderer.state]));
  }

  private heard(event: CompositorEvent): void {
    switch (event.event) {
      case "lock":
        this.locked = event.locked;
        this.schedule();
        break;
      case "outputs-changed":
        this.queue = this.queue.then(async () => {
          await this.loadScreens();
          await this.reconcile();
          this.settle();
        });
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

  /** Make the running processes match the plan and the screens. */
  private async reconcile(): Promise<void> {
    const spec = this.plan?.renderer ?? null;
    const names = spec === null ? [] : this.screens.map((screen) => screen.name);
    const specKey = spec === null ? "" : JSON.stringify(spec);
    if (specKey !== this.rendererKey) {
      await Promise.all([...this.renderers.values()].map((renderer) => renderer.stop()));
      this.renderers.clear();
      this.rendererKey = specKey;
    }
    if (spec === null) return;
    for (const [name, renderer] of [...this.renderers]) {
      if (!names.includes(name)) {
        this.renderers.delete(name);
        await renderer.stop();
      }
    }
    for (const name of names) {
      if (this.renderers.has(name)) continue;
      const renderer = new Supervisor({
        argv: rendererArgv(spec, name),
        spawn: this.options.spawn,
        clock: this.clock,
        log: (message) => this.log(`${name}: ${message}`),
        onGiveUp: (reason) => this.log(`${name}: giving up on the live wallpaper, the still one stays (${reason})`),
      });
      // Not started until the first look says the screen is visible.
      renderer.pause();
      renderer.start();
      this.renderers.set(name, renderer);
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
    const plan = this.plan;
    const reasons: Record<string, PauseReason | null> = {};
    if (plan === null || plan.live.wallpaper.kind === "picture") return reasons;
    const look = ++this.looks;
    // A locked session answers `windows` with an error: nothing is covered, and the lock pauses anyway.
    const windows = this.locked ? [] : await this.options.compositor.windows().catch(() => [] as CompositorWindow[]);
    if (look !== this.looks) return reasons;
    const onBattery = this.options.battery()?.state === "discharging";
    this.wasOnBattery = onBattery;
    const base = {
      locked: this.locked,
      screensOff: this.screensOff,
      onBattery,
      pauseOnBattery: plan.live.pauseOnBattery,
    };
    for (const screen of this.screens) reasons[screen.name] = pauseReason({ ...base, covered: isCovered(screen, windows) });
    if (plan.live.wallpaper.kind === "shader") {
      // One animation for every screen: it stands still when none shows it.
      const hidden = this.screens.length === 0 ? pauseReason({ ...base, covered: false }) !== null : Object.values(reasons).every((reason) => reason !== null);
      this.options.sync.pause(hidden);
      return reasons;
    }
    for (const [name, renderer] of this.renderers) {
      if ((reasons[name] ?? null) === null) renderer.resume();
      else renderer.pause();
    }
    return reasons;
  }
}
