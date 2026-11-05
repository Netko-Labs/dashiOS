/**
 * A full-screen window gets a Desktop of its own (settings.json
 * `spaces.fullscreenDesktop`, on by default), as on a Mac: games and videos
 * take a Desktop, and the others stay a swipe away.
 *
 *   - Entering full screen (any way: arrange.ts calls `around`), a Desktop is
 *     added right after the one the window was on (after the full-screen
 *     ones from there already, so two go in the order they came), the window
 *     and its dialogs move there, it goes full screen there, and the screen
 *     slides to it: one motion, the picture already full screen.
 *   - Leaving (any way), it goes back to the Desktop on its left (the one it
 *     came from, or the nearest left of it if that one was removed), out of
 *     full screen there, at the frame from before; the screen slides back,
 *     and its Desktop is removed once the slide is over.
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

export type FullscreenCompositor = Pick<Compositor, "request" | "on" | "windows">;
export type FullscreenSpaces = Pick<SpacesController, "fullscreenSlots" | "getSnapshot" | "insertFullscreen" | "removeFullscreen" | "switchTo">;

export interface FullscreenDesktopsDeps {
  compositor: FullscreenCompositor;
  desktops: FullscreenSpaces;
  /** After a full-screen window left full screen by going away (closed, minimized, hidden): the menu bar's watch follows (fullscreen.ts). */
  changed?(): void;
  /** How long to wait for a slide before the Desktop it left is removed anyway. */
  slideWaitMs?: number;
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
    // Its dialogs come along (its sheets hang on it wherever it goes).
    const dialogs = (await this.windows()).filter((each) => each.parent === window.id && each.sheetOf === undefined && (each.space ?? from) === from);
    await this.move(window.id, at);
    for (const dialog of dialogs) await this.move(dialog.id, at);
    try {
      // Full screen while it waits there: the screen slides to it as it will stay.
      await toggle();
    } catch (error) {
      await this.move(window.id, origin);
      await desktops.removeFullscreen(window.id);
      throw error;
    }
    await desktops.switchTo(at);
  }

  private async leave(id: number, toggle: () => Promise<void>): Promise<void> {
    const slots = this.deps.desktops.fullscreenSlots;
    const index = slotOf(slots, id);
    const origin = index === null ? null : nearestDesktop(slots, index);
    if (index === null || origin === null) return toggle();
    // Back on its Desktop first, with what was left on its own: out of full screen there, so the slide shows it as it will stay.
    await this.gather(index, origin);
    await toggle();
    await this.slideTo(origin);
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

  /** Everything on Space `index` to Space `into`. */
  private async gather(index: number, into: number): Promise<void> {
    for (const window of await this.windows()) {
      if ((window.space ?? -1) === index && window.sheetOf === undefined) await this.move(window.id, into);
    }
  }

  /** Switch to `target` and wait for the slide to end (or a while). */
  private async slideTo(target: number): Promise<void> {
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
    await desktops.switchTo(target);
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
