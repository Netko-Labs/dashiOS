/**
 * The Desktops as SpacesController (controller.ts) keeps them: the Spaces,
 * their names and labels, which Spaces are full-screen Desktops, and the
 * listeners that hear each real change. Every change goes through `publish`
 * (the labels worked out again) or `set` (the compositor's answer), and
 * `ask` turns a compositor request into one of those.
 */

import type { Compositor, CompositorWindow } from "../../compositor/index.ts";
import { ONE_SPACE, parseSpaces } from "../model.ts";
import { spaceLabels } from "../names.ts";
import type { SpaceNames, SpaceRef, SpacesState } from "../types.ts";
import { Followed } from "./followed.ts";
import { desktopCount, fitSlots, type Slots } from "./slots.ts";

/** What settings.json says about Spaces (settings/settings.ts). */
export interface SpacesSettings {
  /** How many Desktops to have, full-screen ones left out; none says leave them as they are. */
  count?: number;
  /** What each is called (null: after its apps). */
  names?: SpaceNames;
  switchOnActivate: boolean;
  /** A full-screen window gets a Desktop of its own (fullscreen.ts); on when unset. */
  fullscreenDesktop?: boolean;
}

export type SpacesCompositor = Pick<Compositor, "on" | "windows" | "spaces" | "spaceAdd" | "spaceRemove" | "spaceSwitch" | "spaceMove">;

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

export abstract class DesktopsState {
  protected state: Desktops = { ...ONE_SPACE, names: [], labels: ["Desktop 1"], fullscreen: [null] };
  /** Which Spaces are full-screen Desktops, kept with every add and remove this makes. */
  protected slots: (number | null)[] = [null];
  protected windows: readonly CompositorWindow[] = [];
  /** The count (Desktops only) last read from or written to settings.json, so a change is saved once. */
  protected saved: number | undefined;
  protected applied: SpacesSettings | null = null;
  private readonly listeners = new Set<() => void>();
  /** The Spaces someone follows through the renumbering (followed.ts). */
  protected readonly followed = new Followed();

  constructor(
    /** Remember how many Spaces there are (settings.json). */
    protected readonly saveCount: (count: number) => void,
    protected readonly naming: Naming,
  ) {}

  getSnapshot = (): Desktops => this.state;

  /** Keep hold of Space `index` while Spaces are added and removed around it: `ref.index` is where it is now. */
  follow(index: number): SpaceRef {
    return this.followed.follow(index);
  }

  unfollow(ref: SpaceRef): void {
    this.followed.unfollow(ref);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A request whose answer is the Spaces as they are; failures are logged. */
  protected async ask(method: string, call: () => Promise<unknown>): Promise<void> {
    try {
      const answer = await call();
      const state = parseSpaces(answer);
      if (state) this.set(state);
    } catch (error) {
      console.error(`dashi-shell: ${method} failed:`, error instanceof Error ? error.message : error);
    }
  }

  /** A new snapshot from what changed, the labels worked out again; listeners hear only a real change. */
  protected publish(change: Partial<Desktops>): void {
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

  protected set(state: SpacesState): void {
    // More or fewer than this made (settings.json edited by hand): new ones at the end are Desktops.
    if (state.count !== this.slots.length) {
      this.slots = fitSlots(this.slots, state.count);
      // Not a change this made (those renumber what is followed themselves): the last Spaces went.
      this.followed.fit(state.count);
    }
    this.publish({ count: state.count, current: state.current });
    // The compositor is the truth while it runs; the file follows it, counting the Desktops only.
    const desktops = desktopCount(this.slots);
    if (this.applied && desktops !== (this.saved ?? 1)) {
      this.saved = desktops;
      this.saveCount(desktops);
    }
  }
}
