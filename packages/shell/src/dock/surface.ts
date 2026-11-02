/**
 * The Dock's surface: a Metal host on the primary screen. When the primary
 * screen is unplugged the Dock is shown again on the one that took over
 * (`show`), instead of the shell ending. A host that dies by itself is
 * reported (`onLost`) and not opened again here: whether that ends the
 * session or only follows a screen is for the caller to decide, since a host
 * dies at the moment its screen goes (see menubars.ts).
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
  /** The Dock's host died without being closed from here. */
  onLost(output: string | undefined): void;
}

interface Shown {
  output: string | undefined;
  variant: string;
  handle: DockHandle | null;
  alive: boolean;
}

export class DockSurface {
  private current: Shown | null = null;
  private closed = false;

  constructor(private readonly options: DockSurfaceOptions) {}

  /** The screen the Dock is on, `undefined` while it sits wherever the compositor put it or is not shown. */
  get output(): string | undefined {
    return this.current?.output;
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
        this.options.onLost(output);
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

  /** Close the current Dock from our side; its end is not a loss. */
  private retire(): void {
    const shown = this.current;
    this.current = null;
    shown?.handle?.close();
  }
}
