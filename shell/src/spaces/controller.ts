/**
 * Spaces' policy: how many there are (kept in settings.json `spaces.count`),
 * what ⌃← ⌃→ and ⌃1…⌃9 do, a swipe following the fingers, and whether
 * activating a window on another Space switches there (settings.json
 * `spaces.switchOnActivate`, on by default as on a Mac). The compositor
 * keeps each window's Space and slides the windows (comp/src/spaces/); every
 * decision is here.
 */

import type { Compositor, CompositorEvent } from "../compositor.ts";
import { bindingTarget, MAX_SPACES, ONE_SPACE, parseSpaceBinding, parseSpaces, type SpacesState } from "./model.ts";

/** What settings.json says about Spaces (settings.ts). */
export interface SpacesSettings {
  /** How many Spaces to have; none says leave them as they are. */
  count?: number;
  switchOnActivate: boolean;
}

export type SpacesCompositor = Pick<Compositor, "request" | "on">;

export class SpacesController {
  private state: SpacesState = ONE_SPACE;
  private readonly listeners = new Set<() => void>();
  /** The count last read from or written to settings.json, so a change is saved once. */
  private saved: number | undefined;
  private applied: SpacesSettings | null = null;
  /** Held switches go one at a time; only the newest waiting one is sent. */
  private holding: Promise<void> = Promise.resolve();
  private nextHold: { target: number; progress: number } | null = null;
  private holdBusy = false;

  constructor(
    private readonly compositor: SpacesCompositor,
    /** Remember how many Spaces there are (settings.json). */
    private readonly saveCount: (count: number) => void,
  ) {}

  /** Follow the compositor; returns a function that stops. */
  start(): () => void {
    const stop = this.compositor.on((event) => this.heard(event));
    void this.refresh();
    return stop;
  }

  getSnapshot = (): SpacesState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * settings.json changed (or was read at startup). Its count is applied only
   * when it is not the one this controller wrote last (a hand edit, or the
   * file at startup), so a change of its own never comes back as an order.
   */
  async apply(settings: SpacesSettings): Promise<void> {
    const followChanged = this.applied?.switchOnActivate !== settings.switchOnActivate;
    this.applied = settings;
    const count = settings.count !== undefined && settings.count !== this.saved ? settings.count : undefined;
    if (count !== undefined) this.saved = count;
    if (!followChanged && count === undefined) return;
    await this.ask("spaces", { follow: settings.switchOnActivate, ...(count === undefined ? {} : { count }) });
  }

  /** Ask the compositor how things are. */
  async refresh(): Promise<void> {
    await this.ask("spaces", {});
  }

  /** Show Space `index` (the windows slide unless Reduce motion is on). */
  async switchTo(index: number): Promise<void> {
    if (index === this.state.current || index < 0 || index >= this.state.count) return;
    await this.ask("space-switch", { space: index });
  }

  /** A Spaces key (keymap.ts); false when `name` is not one. */
  binding(name: string): boolean {
    const binding = parseSpaceBinding(name);
    if (!binding) return false;
    const target = bindingTarget(binding, this.state);
    if (target !== null) void this.switchTo(target);
    return true;
  }

  /** A new Space at the end; resolves to its index, or null at the limit. */
  async add(): Promise<number | null> {
    if (this.state.count >= MAX_SPACES) return null;
    const answer = await this.compositor.request("space-add", {}).catch((error) => {
      console.error("dashi-shell: no new Space:", error);
      return null;
    });
    const index = (answer as { space?: unknown } | null)?.space;
    await this.refresh();
    return typeof index === "number" ? index : null;
  }

  /** Remove Space `index`; its windows go to the one on its left (the first's to the second). */
  async remove(index: number): Promise<void> {
    if (this.state.count <= 1) return;
    await this.ask("space-remove", { space: index });
  }

  /** Put `window` on Space `index`. */
  async move(window: number, index: number): Promise<void> {
    await this.compositor.request("space-move", { window, space: index }).catch((error) => console.error("dashi-shell: the window did not move:", error));
  }

  /** Hold a switch to `target` `progress` of the way (a swipe). Requests never pile up: the newest wins. */
  hold(target: number, progress: number): void {
    this.nextHold = { target, progress };
    if (this.holdBusy) return;
    this.holdBusy = true;
    this.holding = (async () => {
      while (this.nextHold) {
        const { target: space, progress: at } = this.nextHold;
        this.nextHold = null;
        await this.compositor.request("space-switch", { space, progress: at }).catch(() => {});
      }
      this.holdBusy = false;
    })();
  }

  /** The swipe ended: let the held switch finish at `target`, or go back to `origin`. */
  async release(space: number): Promise<void> {
    this.nextHold = null;
    await this.holding;
    await this.ask("space-switch", { space });
  }

  /** A request whose answer is the Spaces as they are; failures are logged. */
  private async ask(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      const answer = await this.compositor.request(method, params);
      const state = parseSpaces(answer);
      if (state) this.set(state);
    } catch (error) {
      console.error(`dashi-shell: ${method} failed:`, error instanceof Error ? error.message : error);
    }
  }

  private set(state: SpacesState): void {
    if (state.count !== this.state.count || state.current !== this.state.current) {
      this.state = state;
      for (const listener of this.listeners) listener();
    }
    // The compositor is the truth while it runs; the file follows it.
    if (this.applied && state.count !== (this.saved ?? 1)) {
      this.saved = state.count;
      this.saveCount(state.count);
    }
  }

  private heard(event: CompositorEvent): void {
    if (event.event === "space") {
      const state = parseSpaces(event);
      if (state) this.set(state);
    }
  }
}
