/**
 * Mission Control (⌃↑): all windows at once. The compositor draws the motion
 * and reports input (comp/src/overview/); every decision is here. Entering
 * sends it a rectangle per window (plan.ts); a click on a window focuses it
 * and leaves, a press on the background, Esc, or ⌃↑ again just leaves, and
 * windows opening or closing meanwhile send a fresh layout. The Spaces row
 * (spaces/row.tsx) sits at the top: ⌃← ⌃→ and ⌃1…⌃9 change Space without
 * leaving, and a window dragged onto a Space moves there (`extras`). Anything else the
 * person does (a shortcut, the launcher) leaves first, so it never acts under
 * a dimmed desktop. The hardware keys do not: volume is not a window action.
 */

import { parseOutputs } from "../arrange.ts";
import type { Compositor, CompositorEvent } from "../compositor.ts";
import { HARDWARE_BINDINGS } from "../system/keys.ts";
import { planOverview } from "./plan.ts";

/** What the controller asks of the compositor. */
export type OverviewCompositor = Pick<Compositor, "request" | "windows" | "on">;

/** What the overview shows besides the windows: the Spaces row (spaces/). */
export interface OverviewExtras {
  /** Room kept at the top of each screen's usable area, for the row. */
  topInset?: number;
  /** The overview opened or closed. */
  onActive?(active: boolean): void;
  /** A window was dragged and let go at (x, y), global logical pixels. */
  onDrop?(window: number, x: number, y: number): void;
}

/** Bindings that act inside the overview instead of ending it: moving between Spaces. */
const keepsOverview = (name: string): boolean => name === OVERVIEW_BINDING || name.startsWith("space-") || HARDWARE_BINDINGS.includes(name);

/** The binding that opens and closes it (keymap.ts). */
export const OVERVIEW_BINDING = "overview";

export class OverviewController {
  /** Whether the overview is open, as far as the shell knows; the compositor's events keep it honest. */
  private open = false;
  /** Bumped when it opens or closes, so a layout read before the change is not sent after it. */
  private generation = 0;
  private sending = false;
  private again = false;

  constructor(
    private readonly compositor: OverviewCompositor,
    private readonly extras: OverviewExtras = {},
  ) {}

  get active(): boolean {
    return this.open;
  }

  /** Whether it is open; the extras hear each change. */
  private setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.extras.onActive?.(open);
  }

  /** Listen to the compositor; returns a function that stops. */
  start(): () => void {
    return this.compositor.on((event) => this.heard(event));
  }

  toggle(): Promise<void> {
    return this.open ? this.leave() : this.enter();
  }

  async enter(): Promise<void> {
    if (this.open) return;
    this.setOpen(true);
    this.generation++;
    await this.refresh();
  }

  /** Flies the windows back (over `duration` ms, the compositor's default if not given) and returns the desktop its input at once. */
  async leave(duration?: number): Promise<void> {
    if (!this.open) return;
    this.setOpen(false);
    this.generation++;
    try {
      await this.compositor.request("overview", duration === undefined ? {} : { duration });
    } catch (error) {
      console.error("dashi-shell: leaving the overview failed:", error);
    }
  }

  /** A press on a window brings it forward; either way the overview ends. */
  async pick(window: number | null): Promise<void> {
    if (window !== null) {
      // The window may have closed meanwhile; leaving still has to happen.
      await this.compositor.request("focus", { window }).catch(() => {});
    }
    await this.leave();
  }

  /** Reads the windows and screens and sends the layout; one at a time, and the newest wins. */
  private async refresh(): Promise<void> {
    if (this.sending) {
      this.again = true;
      return;
    }
    this.sending = true;
    try {
      do {
        this.again = false;
        await this.send();
      } while (this.again && this.open);
    } finally {
      this.sending = false;
    }
  }

  private async send(): Promise<void> {
    const generation = this.generation;
    try {
      const [windows, outputs] = await Promise.all([this.compositor.windows(), this.compositor.request("outputs")]);
      // Closed (or closed and opened again) while this was being read.
      if (!this.open || generation !== this.generation) return;
      const inset = this.extras.topInset ?? 0;
      const screens = parseOutputs(outputs).map((output) =>
        inset > 0 ? { ...output, usable: { ...output.usable, y: output.usable.y + inset, height: Math.max(1, output.usable.height - inset) } } : output,
      );
      // A sheet goes with its window (portal-host/sheets.ts), not as one of its own.
      await this.compositor.request("overview", {
        windows: planOverview(
          windows.filter((window) => window.sheetOf === undefined),
          screens,
        ),
      });
    } catch (error) {
      // Refused (the screen is locked) or unreachable: it did not open.
      if (generation === this.generation) this.setOpen(false);
      console.error("dashi-shell: the overview did not open:", error);
    }
  }

  private heard(event: CompositorEvent): void {
    const run = (work: Promise<unknown>) => work.catch((error) => console.error("dashi-shell: overview:", error));
    switch (event.event) {
      case "overview":
        // Opened by someone else (a script): its keys and clicks are ours to
        // answer too. Ended by someone else, or by the compositor when the
        // connection that drove it went away: it is closed, unless a layout of
        // ours is on its way (the echo of our own earlier leave).
        if (event.active) this.setOpen(true);
        else if (!this.sending) this.setOpen(false);
        break;
      case "lock":
        // The compositor already ended it.
        if (event.locked) this.setOpen(false);
        break;
      case "overview-pick":
        if (this.open) run(this.pick(event.window));
        break;
      case "overview-key":
        if (this.open && event.key === "Escape") run(this.leave());
        break;
      case "overview-drop":
        if (this.open) this.extras.onDrop?.(event.window, event.x, event.y);
        break;
      case "window-opened":
      case "window-closed":
      case "outputs-changed":
      // Another Space shows, or a window left this one: its windows are laid out.
      case "space":
      case "window-space":
        if (this.open) run(this.refresh());
        break;
      case "binding":
        if (this.open && !keepsOverview(event.name)) run(this.leave());
        break;
      case "super":
        // A tap opens the launcher.
        if (this.open && event.phase === "tap") run(this.leave());
        break;
    }
  }
}
