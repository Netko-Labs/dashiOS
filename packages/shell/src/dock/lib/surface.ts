/**
 * The Dock's surface: a Metal host on the primary screen. When the primary
 * screen is unplugged the Dock is shown again on the one that took over
 * (`show`), instead of the shell ending. A host that dies by itself is
 * opened again on the same screen a moment later, a few times (a host asked
 * for a screen plugged in a moment ago that it never got to know ends
 * without opening: mirin's `screen.rs`); one that keeps dying is reported
 * (`onLost`): whether that ends the session or only follows a screen is for
 * the caller to decide, since a host dies at the moment its screen goes
 * (see menubars.ts).
 *
 * A host's layer-shell options are fixed when it opens, so a surface that
 * must look different (the Dock or the taskbar, with or without an exclusive
 * zone) is a new host: `variant` names the look, and a change of it opens
 * again. `hide` ends the host and keeps the surface ready to `show` again.
 */

export interface DockHandle {
  /** Unmounts and ends the host. */
  close(): void;
}

export interface DockSurfaceOptions {
  /**
   * Opens the Dock on that screen (the compositor's choice when `undefined`) in that variant; `onClosed`
   * runs when its host died by itself.
   */
  open(output: string | undefined, onClosed: () => void, variant: string): DockHandle;
  /** The Dock's host died without being closed from here, and kept dying when opened again. */
  onLost(output: string | undefined): void;
  /** A host that died by itself opens again `delayMs` later, at most `max` times within `windowMs`. */
  retry?: { max: number; windowMs: number; delayMs: number };
  now?(): number;
  /** Runs `fn` later; returns the way to cancel it. */
  later?(fn: () => void, ms: number): () => void;
}

const RETRY = { max: 3, windowMs: 60_000, delayMs: 1000 } as const;

interface Shown {
  output: string | undefined;
  variant: string;
  handle: DockHandle | null;
  alive: boolean;
}

export class DockSurface {
  private current: Shown | null = null;
  private closed = false;
  /** When the Dock's hosts died by themselves lately. */
  private deaths: number[] = [];
  private cancelRetry: (() => void) | null = null;

  constructor(private readonly options: DockSurfaceOptions) {}

  /** The screen the Dock is on, `undefined` while it sits wherever the compositor put it or is not shown. */
  get output(): string | undefined {
    return this.current?.output;
  }

  /** The look of the Dock host that is up; undefined when none is. */
  get variant(): string | undefined {
    return this.current?.alive ? this.current.variant : undefined;
  }

  /** Whether a Dock host is up. */
  get shown(): boolean {
    return this.current?.alive === true;
  }

  /** Show the Dock on `output` in `variant`; does nothing if it is already so. A Dock elsewhere or of another variant is closed first. */
  show(output: string | undefined, variant = ""): void {
    if (this.closed) return;
    if (this.current?.alive && this.current.output === output && this.current.variant === variant) return;
    this.retire();
    const shown: Shown = { output, variant, handle: null, alive: true };
    this.current = shown;
    shown.handle = this.options.open(
      output,
      () => {
        // A Dock we replaced or closed reports its end too; only the current one counts.
        if (this.closed || this.current !== shown || !shown.alive) return;
        shown.alive = false;
        this.died(shown);
      },
      variant,
    );
  }

  /** Take the Dock off the screen; `show` brings it back. */
  hide(): void {
    this.retire();
  }

  close(): void {
    this.closed = true;
    this.retire();
  }

  /** The current Dock's host died: open it again in a moment, unless it keeps dying. */
  private died(shown: Shown): void {
    const { max, windowMs, delayMs } = this.options.retry ?? RETRY;
    const now = (this.options.now ?? Date.now)();
    this.deaths = [...this.deaths.filter((at) => now - at < windowMs), now];
    if (this.deaths.length > max) {
      this.options.onLost(shown.output);
      return;
    }
    console.error(`dashi-shell: the Dock on ${shown.output ?? "its screen"} died; opening it again`);
    this.cancelRetry = (this.options.later ?? timeout)(() => {
      this.cancelRetry = null;
      // Shown elsewhere, hidden or closed meanwhile: that stands.
      if (this.closed || this.current !== shown) return;
      this.current = null;
      this.show(shown.output, shown.variant);
    }, delayMs);
  }

  /** Close the current Dock from our side; its end is not a loss. */
  private retire(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
    const shown = this.current;
    this.current = null;
    shown?.handle?.close();
  }
}

function timeout(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}
