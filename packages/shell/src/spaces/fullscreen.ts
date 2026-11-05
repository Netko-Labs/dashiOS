/**
 * A full-screen window gets a Desktop of its own (settings.json
 * `spaces.fullscreenDesktop`, on by default), as on a Mac: games and videos
 * take a Desktop, and the others stay a swipe away.
 *
 *   - Entering full screen (any way: arrange.ts calls `around`), a Desktop is
 *     added right after the one the window was on (after the full-screen
 *     ones from there already, so two go in the order they came), the window
 *     fills the screen where it is, and once its app has drawn it at that
 *     size it is carried to its Desktop (`space-switch {carry}`): the Spaces
 *     slide under it, out of sight, so the one motion seen is the window
 *     filling the screen. Its dialogs go there too.
 *   - Leaving (any way), it leaves full screen where it is, back at the frame
 *     from before; once drawn so, it is carried to the Desktop on its left
 *     (the one it came from, or the nearest left of it if that one was
 *     removed), which slides in under it, and its Desktop is removed once
 *     the slide is over.
 *   - Closed, minimized, or hidden while full screen: as leaving, the window
 *     staying closed, minimized, or hidden.
 *   - A new window while a full-screen Desktop shows opens on the Desktop it
 *     came from, and the screen slides there, unless it is that app's
 *     dialog (its parent is on the full-screen Desktop) or sheet (which
 *     hangs on its parent anyway). A window put onto a full-screen Desktop
 *     some other way goes back too.
 *
 * Which Spaces are full-screen Desktops is the Spaces controller's (slots.ts),
 * so they are left out of the count and the names. The compositor only moves
 * windows and slides (`space-add {at}`, `space-move`, `place {space}`).
 */

import type { Compositor, CompositorEvent, CompositorWindow, Placing } from "../compositor.ts";
import type { SpacesController } from "./controller.ts";
import { MAX_SPACES } from "./model.ts";
import { belongsTo, insertionPoint, nearestDesktop, originOf, slotOf } from "./slots.ts";

/** A slide takes 250 ms (comp/src/wm/spaces.rs); a Desktop left is removed at the latest this long after. */
const SLIDE_WAIT_MS = 1000;
/** How long an app may take to draw a window at its new size before it is carried anyway. */
const DRAW_WAIT_MS = 500;
/** How often to look whether it has. */
const DRAW_POLL_MS = 16;

export type FullscreenCompositor = Pick<Compositor, "request" | "on" | "windows">;
export type FullscreenSpaces = Pick<SpacesController, "fullscreenSlots" | "getSnapshot" | "insertFullscreen" | "removeFullscreen" | "switchTo">;

export interface FullscreenDesktopsDeps {
  compositor: FullscreenCompositor;
  desktops: FullscreenSpaces;
  /** After a full-screen window left full screen by going away (closed, minimized, hidden): the menu bar's watch follows (fullscreen.ts). */
  changed?(): void;
  /** How long to wait for a slide before the Desktop it left is removed anyway. */
  slideWaitMs?: number;
  /** How long to wait for an app to draw its window at a new size. */
  drawWaitMs?: number;
}

const report = (what: string) => (error: unknown) => console.error(`dashi-shell: ${what}:`, error instanceof Error ? error.message : error);

export class FullscreenDesktops {
  /** settings.json `spaces.fullscreenDesktop`: off, full screen stays on the Desktop it is on. */
  enabled = true;
  /** One change of Desktops at a time, in the order asked. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: FullscreenDesktopsDeps) {}

  /** Follow the compositor; returns a function that stops. */
  start(): () => void {
    return this.deps.compositor.on((event) => this.heard(event));
  }

  /**
   * Enter or leave full screen around `window`'s own Desktop: `toggle` is
   * the `fullscreen` request (and the frame after it); arrange.ts calls this
   * for every way in and out.
   */
  around(window: CompositorWindow, on: boolean, toggle: () => Promise<void>): Promise<void> {
    return this.serial(() => (on ? this.enter(window, toggle) : this.leave(window.id, toggle)));
  }

  /** The Space a new window opens on: the one a full-screen Desktop came from, unless it is that app's dialog; null for the one that shows. */
  async spaceFor(placing: Placing): Promise<number | null> {
    const { desktops } = this.deps;
    const slots = desktops.fullscreenSlots;
    const current = desktops.getSnapshot().current;
    const owner = slots[current] ?? null;
    if (owner === null) return null;
    if (placing.parent !== undefined) {
      if (placing.parent === owner) return null;
      const windows = await this.deps.compositor.windows().catch(() => []);
      if (windows.some((window) => window.id === placing.parent && (window.space ?? current) === current)) return null;
    }
    return nearestDesktop(slots, current);
  }

  /** A new window opened on Space `space` (from `spaceFor`): the screen slides there. */
  async opened(space: number): Promise<void> {
    await this.deps.desktops.switchTo(space);
  }

  private async enter(window: CompositorWindow, toggle: () => Promise<void>): Promise<void> {
    const { desktops } = this.deps;
    const slots = desktops.fullscreenSlots;
    const from = window.space ?? desktops.getSnapshot().current;
    const origin = originOf(slots, from);
    if (!this.enabled || slotOf(slots, window.id) !== null || slots.length >= MAX_SPACES || origin === null) return toggle();
    const at = insertionPoint(slots, origin);
    if (!(await desktops.insertFullscreen(window.id, at))) return toggle();
    const shows = from === desktops.getSnapshot().current;
    // Its dialogs come along (its sheets hang on it wherever it goes).
    const dialogs = (await this.windows()).filter((each) => each.parent === window.id && each.sheetOf === undefined && (each.space ?? from) === from);
    // Not on screen (an agent's): it waits on its Desktop, full screen there.
    if (!shows) await this.move(window.id, at);
    try {
      await toggle();
    } catch (error) {
      if (!shows) await this.move(window.id, origin);
      await desktops.removeFullscreen(window.id);
      throw error;
    }
    for (const dialog of dialogs) await this.move(dialog.id, at);
    if (!shows) return desktops.switchTo(at);
    // Filling the screen where it is; once drawn so, the Spaces slide under it, out of sight.
    await this.drawn(window.id);
    await this.slideTo(at, window.id);
  }

  private async leave(id: number, toggle: () => Promise<void>): Promise<void> {
    const slots = this.deps.desktops.fullscreenSlots;
    const index = slotOf(slots, id);
    const origin = index === null ? null : nearestDesktop(slots, index);
    if (index === null || origin === null) return toggle();
    if (this.deps.desktops.getSnapshot().current !== index) {
      // Its Desktop is not the one that shows: back on its own, out of full screen there.
      await this.gather(index, origin);
      await toggle();
      return this.deps.desktops.removeFullscreen(id);
    }
    // Out of full screen where it is; once drawn at its own frame, its Desktop slides in under it.
    await toggle();
    await this.drawn(id);
    await this.gather(index, origin, id);
    await this.slideTo(origin, id);
    await this.deps.desktops.removeFullscreen(id);
  }

  /** A full-screen window closed, minimized, or hidden: its Desktop goes as if it had left. */
  private async gone(id: number, closed: boolean): Promise<void> {
    const slots = this.deps.desktops.fullscreenSlots;
    const index = slotOf(slots, id);
    const origin = index === null ? null : nearestDesktop(slots, index);
    if (index === null || origin === null) return;
    await this.gather(index, origin);
    // Off screen, it waits at its own frame where it comes back.
    if (!closed) await this.deps.compositor.request("fullscreen", { window: id, on: false }).catch(report("leaving full screen"));
    if (this.deps.desktops.getSnapshot().current === index) await this.slideTo(origin);
    await this.deps.desktops.removeFullscreen(id);
    this.deps.changed?.();
  }

  /** A window put onto a full-screen Desktop that is not its app's (an activation, a push against the edge, an agent): back to the Desktop it came from. */
  private async landed(id: number, space: number): Promise<void> {
    const slots = this.deps.desktops.fullscreenSlots;
    const owner = slots[space] ?? null;
    if (owner === null || owner === id) return;
    const window = (await this.windows()).find((each) => each.id === id);
    if (!window || (window.space ?? space) !== space || belongsTo(window, owner)) return;
    const origin = nearestDesktop(slots, space);
    if (origin === null) return;
    await this.move(id, origin);
    if (this.deps.desktops.getSnapshot().current === space) await this.deps.desktops.switchTo(origin);
  }

  /** Everything on Space `index` to Space `into` (but `except`, carried there). */
  private async gather(index: number, into: number, except?: number): Promise<void> {
    for (const window of await this.windows()) {
      if ((window.space ?? -1) === index && window.sheetOf === undefined && window.id !== except) await this.move(window.id, into);
    }
  }

  /** Until window `id`'s app has drawn it at the size it was last asked to take (its `configuring` gone), or a while. */
  private async drawn(id: number): Promise<void> {
    const until = Date.now() + (this.deps.drawWaitMs ?? DRAW_WAIT_MS);
    for (;;) {
      const window = (await this.windows()).find((each) => each.id === id);
      if (!window?.configuring || Date.now() >= until) return;
      await new Promise((resolve) => setTimeout(resolve, DRAW_POLL_MS));
    }
  }

  /** Switch to `target` (carrying window `carry` along) and wait for the slide to end (or a while). */
  private async slideTo(target: number, carry?: number): Promise<void> {
    const { compositor, desktops } = this.deps;
    if (desktops.getSnapshot().current === target) return;
    let stop = (): void => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arrived = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.deps.slideWaitMs ?? SLIDE_WAIT_MS);
      stop = compositor.on((event) => {
        if (event.event === "space" && event.current === target) resolve();
      });
    });
    await desktops.switchTo(target, carry);
    await arrived;
    stop();
    clearTimeout(timer);
  }

  private move(window: number, space: number): Promise<unknown> {
    return this.deps.compositor.request("space-move", { window, space }).catch(report("moving a window between Desktops"));
  }

  private windows(): Promise<CompositorWindow[]> {
    return this.deps.compositor.windows().catch(() => []);
  }

  private heard(event: CompositorEvent): void {
    const owns = (id: number) => slotOf(this.deps.desktops.fullscreenSlots, id) !== null;
    if (event.event === "window-closed" && owns(event.id)) void this.serial(() => this.gone(event.id, true)).catch(report("closing a full-screen Desktop"));
    else if (event.event === "window-state" && event.state !== "normal" && owns(event.window)) {
      void this.serial(() => this.gone(event.window, false)).catch(report("closing a full-screen Desktop"));
    } else if (event.event === "window-space") void this.serial(() => this.landed(event.window, event.space)).catch(report("keeping a full-screen Desktop"));
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }
}
