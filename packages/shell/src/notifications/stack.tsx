/**
 * The banner stack: one Metal overlay per visible notification, top right
 * under the menu bar, stacked downward in the order they arrived.
 *
 * A host can't move or resize its layer surface, so a banner whose place or
 * size changes (one above it went away, its text was replaced) gets a new
 * host; the old one stays until the new one has had time to paint, so it
 * jumps instead of blinking. A banner that only changed its words repaints in
 * place: it follows the store itself (banner.tsx).
 */

import { type NativeHostOptions, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { BANNER, Banner, bannerHeight, bannerSurface } from "./banner.tsx";
import type { NotificationStore } from "./store.ts";
import type { Notification } from "./types.ts";

export const BANNER_NAMESPACE = "dashi.notifications";
/** How long a replaced banner's old surface outlives the new one. */
const HANDOFF_MS = 150;

export type SpawnHost = (options: NativeHostOptions) => NativeTransport;

interface Shown {
  host: NativeTransport;
  root: NativeRoot;
  /** The panel's distance below the first banner's top, and its height. */
  top: number;
  height: number;
}

export interface Placement {
  id: number;
  top: number;
  height: number;
}

/** Where each banner goes: stacked top to bottom, the panels one shadow-width apart. */
export function place(banners: readonly Pick<Notification, "id" | "body" | "actions">[]): Placement[] {
  let top = 0;
  return banners.map((banner) => {
    const height = bannerHeight(banner);
    const placement = { id: banner.id, top, height };
    top += height + BANNER.shadow;
    return placement;
  });
}

export class BannerStack {
  private readonly shown = new Map<number, Shown>();
  private stop: (() => void) | null = null;
  /** The screen of the current run of banners; set once `chosen`. */
  private output: string | undefined;
  private chosen = false;
  private choosing = false;

  constructor(
    private readonly store: NotificationStore,
    private readonly spawn: SpawnHost,
    private readonly handoffMs = HANDOFF_MS,
    /** Which screen a run of banners appears on (an output name); the compositor's choice when it gives none. */
    private readonly screen?: () => Promise<string | undefined>,
  ) {}

  start(): () => void {
    this.stop = this.store.subscribe(() => this.sync());
    this.sync();
    return () => this.close();
  }

  close(): void {
    this.stop?.();
    this.stop = null;
    this.chosen = false;
    for (const shown of this.shown.values()) this.release(shown);
    this.shown.clear();
  }

  /** The ids on screen, in the order of their surfaces' creation. */
  get ids(): number[] {
    return [...this.shown.keys()];
  }

  private sync(): void {
    const banners = this.store.getSnapshot().banners;
    const wanted = new Map(place(banners).map((placement) => [placement.id, placement]));
    for (const [id, shown] of [...this.shown]) {
      if (wanted.has(id)) continue;
      this.shown.delete(id);
      this.release(shown);
    }
    // A run is over when nothing is shown and nothing waits; the next one may be on another screen.
    if (banners.length === 0 && this.shown.size === 0) this.chosen = false;
    if (banners.length > 0 && !this.chosen && this.screen) {
      this.choose(this.screen);
      return;
    }
    for (const banner of banners) {
      const placement = wanted.get(banner.id) as Placement;
      const current = this.shown.get(banner.id);
      if (current && current.top === placement.top && current.height === placement.height) continue;
      const next = this.open(banner, placement);
      if (current) setTimeout(() => this.release(current), this.handoffMs);
      if (next) this.shown.set(banner.id, next);
      else this.shown.delete(banner.id);
    }
  }

  /** Asks for the run's screen, then draws whatever the store holds by then. */
  private choose(screen: () => Promise<string | undefined>): void {
    if (this.choosing) return;
    this.choosing = true;
    void screen()
      .catch(() => undefined)
      .then((output) => {
        this.choosing = false;
        // Closed meanwhile: nothing is drawn.
        if (!this.stop) return;
        this.output = output;
        this.chosen = true;
        this.sync();
      });
  }

  private open(banner: Notification, placement: Placement): Shown | null {
    const { width, height } = bannerSurface(banner);
    let host: NativeTransport;
    try {
      host = this.spawn({
        title: "Notification",
        appId: "dev.dashi.shell",
        width,
        height,
        surface: {
          layer: "overlay",
          anchor: ["top", "right"],
          margin: { top: placement.top },
          namespace: BANNER_NAMESPACE,
          ...(this.output === undefined ? {} : { output: this.output }),
        },
      });
    } catch (error) {
      console.error("dashi-shell: could not open a notification banner:", error instanceof Error ? error.message : error);
      return null;
    }
    const root = render(<Banner store={this.store} id={banner.id} />, host);
    const shown: Shown = { host, root, top: placement.top, height: placement.height };
    // A banner whose surface died is forgotten; the next change draws it again.
    host.onClose(() => {
      if (this.shown.get(banner.id) === shown) this.shown.delete(banner.id);
    });
    return shown;
  }

  private release(shown: Shown): void {
    shown.root.unmount();
    shown.host.close();
  }
}
