/**
 * A menu bar on every screen, as on a Mac with a monitor plugged in. A Metal
 * host is one layer surface on one screen, so each screen gets its own host
 * (keyed by output name), all rendering the same MenuBar over the same stores.
 * Bars come and go with `outputs-changed`.
 *
 * The primary screen's bar is the shell's anchor: the Dock sits on that
 * screen too, and its host is the one that reports the windows
 * (`shell.toplevels`), since it is the one surface that is always there (the
 * Dock may be hidden, and a strip kept only for this got in the way of a
 * window's bottom edge). When the primary screen is unplugged the primary moves to a
 * screen that is left (the Dock follows, `onPrimaryChanged`) and the shell
 * goes on; the new primary's bar is opened again as the anchor, because a
 * host's capabilities are fixed when it opens. When its host dies while the screen is still there, the session
 * ends: the supervisor then starts a shell that picks the primary again. Any
 * other bar closes quietly when its screen goes away; if its host dies while
 * the screen is still there, it is opened again a few times before giving up.
 *
 * A host usually dies at the moment its screen goes, and that can be heard
 * before the compositor's `outputs-changed`; so a dead primary host is only
 * the end of the session if the screens, asked again, still list its screen.
 */

// biome-ignore lint/nursery/noImportCycles: H5 offender (scripts/lists/import-cycles.txt)
import { isBuiltIn } from "./displays.ts";

/** The screen that holds the Dock and the session's anchor bar: the laptop's panel, else the first. */
export function choosePrimary(names: readonly string[]): string | null {
  return names.find(isBuiltIn) ?? names[0] ?? null;
}

/** The primary screen: the one the compositor was told to treat as the main display, if it is there, else `choosePrimary`'s. */
export function pickPrimary(names: readonly string[], preferred: string | null | undefined): string | null {
  return preferred != null && names.includes(preferred) ? preferred : choosePrimary(names);
}

/** Which bars to open and which to close so that exactly `wanted` have one. */
export function planBars(wanted: readonly string[], open: Iterable<string>): { open: string[]; close: string[] } {
  const have = new Set(open);
  const want = new Set(wanted);
  return { open: [...want].filter((name) => !have.has(name)), close: [...have].filter((name) => !want.has(name)) };
}

/** What `MenuBars` needs of one bar: closing it, from our side. */
export interface BarHandle {
  /** Idempotent; also runs the `onClosed` it was opened with. */
  close(): void;
}

export interface MenuBarsOptions {
  /**
   * Opens a bar on that screen (the compositor's choice when `undefined`); `onClosed` runs once when it goes, however it went.
   * The `primary` bar is the anchor: its host reports the windows.
   */
  open(output: string | undefined, onClosed: () => void, primary: boolean): BarHandle;
  /** The primary bar's host died with its screen still there: the session is going away. */
  onPrimaryLost(): void;
  /** The primary screen changed because the old one left; the Dock should follow. */
  onPrimaryChanged?(name: string): void;
  /**
   * The screens now, asked fresh (null if that failed). Without it a dead
   * primary host ends the session at once.
   */
  screens?(): Promise<string[] | null>;
  /** A bar that died by itself comes back at most `max` times within `windowMs`, `delayMs` after it died. */
  retry?: { max: number; windowMs: number; delayMs: number };
  now?(): number;
  /** Runs `fn` later; returns the way to cancel it. */
  later?(fn: () => void, ms: number): () => void;
}

const RETRY = { max: 3, windowMs: 60_000, delayMs: 1000 } as const;

/** The key of a bar opened before any screen was known. */
const BLIND = "";

export class MenuBars {
  private readonly bars = new Map<string, BarHandle>();
  /** Screens that should have a bar, in the compositor's order. */
  private wanted: string[] = [];
  /** The anchor bar's screen; `BLIND` while its bar sits wherever the compositor put it; null before `start`. */
  private primary: string | null = null;
  private readonly deaths = new Map<string, number[]>();
  private readonly timers = new Set<() => void>();
  private closed = false;

  constructor(private readonly options: MenuBarsOptions) {}

  /** The screen of the anchor bar, once known. */
  get primaryName(): string | null {
    return this.primary === BLIND ? null : this.primary;
  }

  /** Opens the primary screen's bar (`preferred`: the main display Settings chose). Without screens it opens one the compositor places. */
  start(screens: readonly string[], preferred?: string | null): void {
    this.wanted = [...screens];
    this.primary = pickPrimary(screens, preferred) ?? BLIND;
    this.openBar(this.primary);
    this.reconcile();
  }

  /**
   * The screens changed: a bar for each new one, and the bars of those that left are closed.
   * `preferred` is the main display the compositor was told of; the primary moves to it
   * when it is a screen that is there.
   */
  sync(screens: readonly string[], preferred?: string | null): void {
    if (this.closed) return;
    this.wanted = [...screens];
    // A bar opened blind sits on the compositor's first screen; take it as the primary's.
    const blind = this.bars.get(BLIND);
    const primary = pickPrimary(screens, preferred);
    if (blind && primary !== null) {
      this.bars.delete(BLIND);
      this.bars.set(primary, blind);
      this.primary = primary;
    }
    // The primary's screen left, or another was made the main display: the primary moves. With
    // no screens at all (or a failed query that looked like it) nothing moves.
    const home = this.primary;
    const leftOrChosen = home !== null && (!screens.includes(home) || (preferred != null && preferred !== home && screens.includes(preferred)));
    if (home !== null && home !== BLIND && screens.length > 0 && leftOrChosen) {
      this.primary = primary;
      const old = this.bars.get(home);
      this.bars.delete(home);
      old?.close();
      if (primary !== null) {
        // The bar already on the new primary was opened as an ordinary one.
        const next = this.bars.get(primary);
        this.bars.delete(primary);
        next?.close();
        this.options.onPrimaryChanged?.(primary);
      }
    }
    this.reconcile();
  }

  close(): void {
    this.closed = true;
    for (const cancel of this.timers) cancel();
    this.timers.clear();
    const bars = [...this.bars.values()];
    this.bars.clear();
    for (const bar of bars) bar.close();
  }

  private reconcile(): void {
    const plan = planBars(this.wanted, this.bars.keys());
    for (const name of plan.close) {
      // The primary's host ends the session when it goes; closing it here would race that.
      if (name === this.primary) continue;
      const bar = this.bars.get(name);
      this.bars.delete(name);
      bar?.close();
    }
    for (const name of plan.open) this.openBar(name);
  }

  /** The primary bar's host died: the screen left (move on), or the host crashed (the session ends). */
  private async primaryDied(name: string, screens: () => Promise<string[] | null>): Promise<void> {
    const now = await screens().catch(() => null);
    if (this.closed) return;
    // The primary may have moved while we asked.
    if (this.primary !== name || this.bars.has(name)) return;
    if (now && now.length > 0 && !now.includes(name)) this.sync(now);
    else this.endSession();
  }

  /** The session is going away: no bar is opened again after this. */
  private endSession(): void {
    this.closed = true;
    this.options.onPrimaryLost();
  }

  private openBar(name: string): void {
    // The handle is not known until `open` returns, and a host can die before that.
    let handle: BarHandle | null = null;
    let diedEarly = false;
    handle = this.options.open(
      name === BLIND ? undefined : name,
      () => {
        if (handle) this.lost(handle);
        else diedEarly = true;
      },
      name === this.primary,
    );
    this.bars.set(name, handle);
    if (diedEarly) this.lost(handle);
  }

  /** A bar's host died. Bars closed from our side are no longer in the map and are ignored. */
  private lost(bar: BarHandle): void {
    const name = [...this.bars].find(([, each]) => each === bar)?.[0];
    if (this.closed || name === undefined) return;
    this.bars.delete(name);
    if (name === this.primary) {
      if (this.options.screens) void this.primaryDied(name, this.options.screens);
      else this.endSession();
      return;
    }
    const { max, windowMs, delayMs } = this.options.retry ?? RETRY;
    const now = (this.options.now ?? Date.now)();
    const recent = [...(this.deaths.get(name) ?? []).filter((at) => now - at < windowMs), now];
    this.deaths.set(name, recent);
    if (recent.length > max) {
      console.error(`dashi-shell: the menu bar on ${name} keeps dying; leaving that screen without one`);
      return;
    }
    console.error(`dashi-shell: the menu bar on ${name} died; opening it again`);
    const later = this.options.later ?? timeout;
    const cancel = later(() => {
      this.timers.delete(cancel);
      // The screen may have left in the meantime.
      if (!this.closed && this.wanted.includes(name) && !this.bars.has(name)) this.openBar(name);
    }, delayMs);
    this.timers.add(cancel);
  }
}

function timeout(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}
