/**
 * The menu bar over a full-screen window. A full-screen window hides its
 * screen's menu bar and Dock (comp/src/fullscreen.rs); as on a Mac, pushing
 * the pointer against the top edge brings the menu bar down, and leaving it
 * sends it away. The compositor offers two mechanisms (IPC `bars`,
 * comp/src/bars.rs) and this decides the rest:
 *
 *   - while any window is full screen, watch the top 1 px of the screens;
 *   - the pointer entering it holds the bars out on that screen and widens
 *     the band to the menu bar's height, so leaving the bar ends it;
 *   - an open menu keeps the bar until it closes (its dropdown is below the
 *     band, and the bar must not vanish under it).
 */

import type { Compositor, CompositorEvent } from "./compositor.ts";

/** What the bars need of the compositor. */
export type BarsCompositor = Pick<Compositor, "request" | "windows" | "on">;

/** How far the pointer pushes to reach the bar: the top row of pixels. */
export const EDGE_BAND = 1;

export class FullscreenBars {
  private watching = false;
  private out: string | undefined;
  private held = false;
  /** Serializes requests, so a quick in-and-out cannot leave them crossed. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly compositor: BarsCompositor,
    private readonly barHeight: number,
  ) {}

  /** Follows the compositor's events; returns a stop function. */
  start(): () => void {
    const stop = this.compositor.on((event) => this.heard(event));
    return () => {
      stop();
      this.enqueue(() => this.release());
    };
  }

  /** A window entered or left full screen, or closed: watch the edge only while one is there. */
  sync(): Promise<void> {
    return this.enqueue(async () => {
      const windows = await this.compositor.windows().catch(() => []);
      const any = windows.some((window) => window.fullscreen === true && window.state === "normal");
      if (any && !this.watching) {
        this.watching = true;
        await this.ask({ top: EDGE_BAND });
      } else if (!any && this.watching) {
        await this.release();
      }
    });
  }

  /** A menu is open (its row may be on the revealed bar) or closed. */
  hold(open: boolean): void {
    if (this.held === open) return;
    this.held = open;
    if (!open) this.enqueue(() => (this.out === undefined ? undefined : this.hide()));
  }

  private heard(event: CompositorEvent): void {
    if (event.event === "window-closed") void this.sync();
    else if (event.event === "bars-edge" && this.watching) {
      this.enqueue(() => (event.inside ? this.reveal(event.output) : this.held ? undefined : this.hide()));
    }
  }

  private async reveal(output: string | undefined): Promise<void> {
    if (this.out !== undefined) return;
    this.out = output ?? "";
    await this.ask({ show: true, ...(output === undefined ? {} : { output }) });
    await this.ask({ top: this.barHeight });
  }

  private async hide(): Promise<void> {
    if (this.out === undefined) return;
    const output = this.out;
    this.out = undefined;
    await this.ask({ show: false, ...(output === "" ? {} : { output }) });
    if (this.watching) await this.ask({ top: EDGE_BAND });
  }

  private async release(): Promise<void> {
    this.watching = false;
    this.out = undefined;
    await this.ask({ top: 0 });
    await this.ask({ show: false });
  }

  private ask(params: Record<string, unknown>): Promise<unknown> {
    return this.compositor.request("bars", params).catch((error) => {
      console.error("dashi-shell: dashi-comp refused a menu bar request:", error instanceof Error ? error.message : error);
    });
  }

  private enqueue(work: () => Promise<void> | void): Promise<void> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }
}
