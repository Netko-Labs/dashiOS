/**
 * Spaces' policy: how many there are (kept in settings.json `spaces.count`),
 * what ⌃← ⌃→ and ⌃1…⌃9 do, a swipe following the fingers, and whether
 * activating a window on another Space switches there (settings.json
 * `spaces.switchOnActivate`, on by default as on a Mac). The compositor
 * keeps each window's Space and slides the windows (comp/src/spaces/); every
 * decision is here. Desktops' names (settings.json `spaces.names`) and what
 * each one is called meanwhile (names.ts) are kept here too, and which
 * Spaces are full-screen windows' own Desktops (slots.ts; what goes on them
 * is fullscreen.ts's): those are left out of the count and the names.
 */

import type { Compositor, CompositorEvent, CompositorWindow } from "../compositor.ts";
import { bindingTarget, MAX_SPACES, ONE_SPACE, parseSpaceBinding, parseSpaces, type SpacesState } from "./model.ts";
import { renamed, type SpaceNames, spaceLabels, withoutSpace } from "./names.ts";
import { desktopCount, desktopOrdinal, fitSlots, nearestDesktop, recoverSlots, type Slots, slotOf } from "./slots.ts";

/** What settings.json says about Spaces (settings.ts). */
export interface SpacesSettings {
  /** How many Desktops to have, full-screen ones left out; none says leave them as they are. */
  count?: number;
  /** What each is called (null: after its apps). */
  names?: SpaceNames;
  switchOnActivate: boolean;
  /** A full-screen window gets a Desktop of its own (fullscreen.ts); on when unset. */
  fullscreenDesktop?: boolean;
}

export type SpacesCompositor = Pick<Compositor, "request" | "on" | "windows">;

/** The Desktops as people see them: the Spaces, their given names, and what each is called now. */
export interface Desktops extends SpacesState {
  names: SpaceNames;
  /** One per Desktop: its name, else after its apps, else "Desktop N" (names.ts). */
  labels: string[];
  /** One per Space: the window whose full-screen Desktop it is, or null (slots.ts). */
  fullscreen: Slots;
}

/** How Desktops get their names: what an app is called, and where names are kept. */
export interface Naming {
  /** What the Dock calls a window's app. */
  appName?(window: CompositorWindow): string;
  /** Remember the names (settings.json `spaces.names`). */
  saveNames?(names: SpaceNames): void;
}

const same = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((each, index) => each === b[index]);

export class SpacesController {
  private state: Desktops = { ...ONE_SPACE, names: [], labels: ["Desktop 1"], fullscreen: [null] };
  /** Which Spaces are full-screen Desktops, kept with every add and remove this makes. */
  private slots: (number | null)[] = [null];
  /** The full-screen Desktops found at the first settings (a restart of the shell). */
  private recovery: Promise<void> | null = null;
  private windows: readonly CompositorWindow[] = [];
  private relabeling = false;
  private relabelAgain = false;
  private readonly listeners = new Set<() => void>();
  /** The ×, or a remove, on a full-screen Desktop: its window leaves full screen (fullscreen.ts). */
  leaveFullscreen: ((window: number) => void) | null = null;
  /** The count (Desktops only) last read from or written to settings.json, so a change is saved once. */
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
    private readonly naming: Naming = {},
  ) {}

  /** Follow the compositor; returns a function that stops. */
  start(): () => void {
    const stop = this.compositor.on((event) => this.heard(event));
    void this.refresh();
    void this.relabel();
    return stop;
  }

  getSnapshot = (): Desktops => this.state;

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
    this.publish({ names: settings.names ?? [] });
    // First, the full-screen Desktops already there (the shell restarted), so the count below leaves them be.
    await (this.recovery ??= this.recover(settings));
    this.applied = settings;
    const count = settings.count !== undefined && settings.count !== this.saved ? settings.count : undefined;
    if (count !== undefined) this.saved = count;
    if (!followChanged && count === undefined) return;
    const spaces = count === undefined ? {} : { count: Math.min(MAX_SPACES, count + this.slots.length - desktopCount(this.slots)) };
    await this.ask("spaces", { follow: settings.switchOnActivate, ...spaces });
  }

  /** The full-screen Desktops from before a restart: a Space whose one window is full screen (slots.ts). */
  private async recover(settings: SpacesSettings): Promise<void> {
    if (settings.fullscreenDesktop === false) return;
    try {
      const [answer, windows] = await Promise.all([this.compositor.request("spaces", {}), this.compositor.windows()]);
      const state = parseSpaces(answer);
      if (!state) return;
      // settings.json counts the Desktops only: the Spaces beyond that were full-screen ones.
      const expected = settings.count === undefined ? undefined : Math.max(0, state.count - settings.count);
      this.windows = windows;
      this.slots = recoverSlots(state.count, windows, expected);
      this.publish({ count: state.count, current: state.current });
    } catch (error) {
      console.error("dashi-shell: finding full-screen Desktops:", error instanceof Error ? error.message : error);
    }
  }

  /** Ask the compositor how things are. */
  async refresh(): Promise<void> {
    await this.ask("spaces", {});
  }

  /** Show Space `index` (the windows slide unless Reduce motion is on). */
  /** Show Space `index`; `carry`, a window on the Space that shows, stays on screen and goes along (`space-switch {carry}`). */
  async switchTo(index: number, carry?: number): Promise<void> {
    if (index === this.state.current || index < 0 || index >= this.state.count) return;
    await this.ask("space-switch", { space: index, ...(carry === undefined ? {} : { carry }) });
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

  /**
   * Remove Space `index`; its windows go to the Desktop on its left (the
   * first's to the second; never onto a full-screen Desktop). The last
   * Desktop stays. A full-screen Desktop's window leaves full screen instead.
   */
  async remove(index: number): Promise<void> {
    const slots = this.slots;
    const owner = slots[index];
    if (owner === undefined) return;
    if (owner !== null) return this.leaveFullscreen?.(owner);
    const into = nearestDesktop(slots, index);
    if (into === null) return;
    // The compositor gives them to the Space on the left (the first's to the second): not when that is a full-screen one.
    if (slots[index === 0 ? 1 : index - 1] !== null) {
      const windows = await this.compositor.windows().catch(() => []);
      for (const window of windows.filter((each) => (each.space ?? 0) === index)) {
        await this.compositor.request("space-move", { window: window.id, space: into }).catch(() => {});
      }
    }
    const ordinal = desktopOrdinal(slots, index);
    const count = this.state.count;
    this.slots = slots.filter((_, at) => at !== index);
    await this.ask("space-remove", { space: index });
    if (this.state.count === count) {
      this.slots = [...slots];
      return;
    }
    // Removed: the names after it move down one, as the Desktops did.
    if (ordinal < this.state.names.length) {
      const names = withoutSpace(this.state.names, ordinal);
      this.publish({ names });
      this.naming.saveNames?.(names);
    }
  }

  /** The full-screen Desktops as they are: the window of each, or null (slots.ts). */
  get fullscreenSlots(): Slots {
    return this.slots;
  }

  /** A full-screen Desktop for `window` at index `at`, the Spaces from there moving up one; false when there can't be one. */
  async insertFullscreen(window: number, at: number): Promise<boolean> {
    if (this.slots.length >= MAX_SPACES || at < 0 || at > this.slots.length) return false;
    const before = this.slots;
    // Known before the compositor says the count changed, so the count saved stays the Desktops'.
    this.slots = [...before.slice(0, at), window, ...before.slice(at)];
    try {
      const state = parseSpaces(await this.compositor.request("space-add", { at }));
      if (state) this.set(state);
      return true;
    } catch (error) {
      console.error("dashi-shell: no full-screen Desktop:", error instanceof Error ? error.message : error);
      this.slots = [...before];
      this.publish({});
      return false;
    }
  }

  /** Remove `window`'s full-screen Desktop (what is still on it goes to the Space on its left). */
  async removeFullscreen(window: number): Promise<void> {
    const index = slotOf(this.slots, window);
    if (index === null || this.slots.length <= 1) return;
    const before = this.slots;
    const count = this.state.count;
    this.slots = before.filter((_, at) => at !== index);
    await this.ask("space-remove", { space: index });
    if (this.state.count === count) this.slots = [...before];
    this.publish({});
  }

  /** Put `window` on Space `index`, or on a new one at the end. Never onto a full-screen Desktop, nor a full-screen window off its own. */
  async move(window: number, index: number | "new"): Promise<void> {
    if (this.slots.includes(window) || (index !== "new" && (this.slots[index] ?? null) !== null)) return;
    const space = index === "new" ? await this.add() : index;
    if (space === null) return;
    await this.compositor.request("space-move", { window, space }).catch((error) => console.error("dashi-shell: the window did not move:", error));
  }

  /** Call Desktop `index` `text` (nothing: after its apps again), and remember it. A full-screen Desktop keeps its app's name. */
  rename(index: number, text: string): void {
    if (index < 0 || index >= this.state.count || (this.slots[index] ?? null) !== null) return;
    const names = renamed(this.state.names, desktopOrdinal(this.slots, index), text);
    this.publish({ names });
    this.naming.saveNames?.(names);
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

  /** A new snapshot from what changed, the labels worked out again; listeners hear only a real change. */
  private publish(change: Partial<Desktops>): void {
    const next = { ...this.state, ...change };
    const appName = this.naming.appName ?? ((window: CompositorWindow) => window.appId);
    const fullscreen = [...this.slots];
    const labels = spaceLabels(next.count, next.names, this.windows, appName, fullscreen);
    const unchanged =
      next.count === this.state.count &&
      next.current === this.state.current &&
      same(labels, this.state.labels) &&
      same(next.names, this.state.names) &&
      same(fullscreen, this.state.fullscreen);
    if (unchanged) return;
    this.state = { ...next, labels, fullscreen };
    for (const listener of this.listeners) listener();
  }

  /** Read the windows again for the automatic names; one read at a time, the last change wins. */
  async relabel(): Promise<void> {
    if (this.relabeling) {
      this.relabelAgain = true;
      return;
    }
    this.relabeling = true;
    try {
      do {
        this.relabelAgain = false;
        this.windows = await this.compositor.windows();
        this.publish({});
      } while (this.relabelAgain);
    } catch (error) {
      console.error("dashi-shell: naming Desktops:", error instanceof Error ? error.message : error);
    } finally {
      this.relabeling = false;
    }
  }

  private set(state: SpacesState): void {
    // More or fewer than this made (settings.json edited by hand): new ones at the end are Desktops.
    if (state.count !== this.slots.length) this.slots = fitSlots(this.slots, state.count);
    this.publish({ count: state.count, current: state.current });
    // The compositor is the truth while it runs; the file follows it, counting the Desktops only.
    const desktops = desktopCount(this.slots);
    if (this.applied && desktops !== (this.saved ?? 1)) {
      this.saved = desktops;
      this.saveCount(desktops);
    }
  }

  private heard(event: CompositorEvent): void {
    switch (event.event) {
      case "space": {
        const state = parseSpaces(event);
        if (state) this.set(state);
        break;
      }
      // Known at once, so a full-screen window's Desktop is named after it even before the windows are read again.
      case "window-space":
        this.windows = this.windows.map((window) => (window.id === event.window ? { ...window, space: event.space } : window));
        void this.relabel();
        break;
      // What is on each Desktop changed: so may what it is called.
      case "window-opened":
      case "window-closed":
      case "window-state":
        void this.relabel();
        break;
    }
  }
}
