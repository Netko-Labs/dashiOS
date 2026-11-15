/**
 * dashi-portal's dialogs as sheets: before it opens a dialog, the portal
 * says which window it is for (`ExpectSheet`, protocol.ts); when that window
 * asks to be placed, the shell finds the parent the handle names (IPC
 * `window-for-handle`) and attaches the dialog to it (IPC `attach`, the
 * compositor keeps it there). A handle that names no window leaves the
 * dialog an ordinary window, placed as any other (arrange.ts). One of
 * Dashi's own apps names its window by its process (`dashi:PID`: a Metal
 * window exports no handle), and the shell finds the window: the one that
 * process draws, the focused one first, and only a window of Dashi's own.
 *
 * A sheet hangs under the parent's title bar. dashi-comp knows the height of
 * the bars it draws; for a window that draws its own (a browser's tabs and
 * toolbar, a GTK header bar, Dashi's unified toolbars) the shell guesses it
 * (`sheetTop`) and says so (`attach {top}`), so the sheet doesn't cover the
 * app's toolbar.
 */

import type { Compositor, CompositorWindow, Placing } from "../compositor/index.ts";
import { ownWindowPid, PORTAL_APP_ID, parseParentWindow } from "../shared/portal-host/index.ts";

/** An expectation older than this is forgotten: the portal's window never came. */
const EXPECT_MS = 15_000;
const MAX_PENDING = 32;

export interface SheetHost {
  windowForHandle: Compositor["windowForHandle"];
  windows: Compositor["windows"];
  attach: Compositor["attach"];
}

/** Where a sheet hangs below the top of a window that draws its own bar, by kind of app (points). */
export const SHEET_TOPS = {
  /** Tabs and a toolbar: Chromium's and Firefox's, about 80 points together. */
  browser: 80,
  /** Dashi's own apps: the unified toolbar (@dashi/ui's AppWindow, TOOLBAR_HEIGHT). */
  dashi: 38,
  /** Anything else that draws its own: a GTK 4 / libadwaita header bar. */
  other: 46,
} as const;

const BROWSERS = /(helium|chrom|brave|vivaldi|opera|edge|firefox|librewolf|zen|floorp|waterfox)/i;

/**
 * How far below the top of `parent`'s frame a sheet hangs (`attach {top}`):
 * nothing for a window with dashi-comp's title bar (it knows), else a guess
 * by the kind of app, since a client-side title bar's height isn't told.
 */
export function sheetTop(parent: Pick<CompositorWindow, "appId" | "titleBar">): number | undefined {
  if (parent.titleBar > 0) return undefined;
  if (/^dev\.(dashi|mirin)\./.test(parent.appId)) return SHEET_TOPS.dashi;
  if (BROWSERS.test(parent.appId)) return SHEET_TOPS.browser;
  return SHEET_TOPS.other;
}

const DASHI_APP = /^dev\.dashi\./;

/**
 * The window a Dashi app means by its own process: one whose client is that process or its child
 * (a Metal host's app), the focused one first. Only a window of Dashi's own apps, never a dialog of
 * the portal's or a sheet: a process number can be guessed, an exported handle cannot.
 */
export function ownWindowOf(pid: number, windows: readonly CompositorWindow[], owners: (pid: number | null) => readonly number[]): number | null {
  const theirs = windows.filter(
    (each) => DASHI_APP.test(each.appId) && each.appId !== PORTAL_APP_ID && each.sheetOf === undefined && owners(each.pid).includes(pid),
  );
  return (theirs.find((each) => each.focused) ?? theirs[0])?.id ?? null;
}

export class PortalSheets {
  private readonly pending = new Map<string, { parent: string; until: number }>();

  constructor(
    private readonly host: SheetHost,
    /** Places a window that is not a sheet after all (the Arranger). */
    private readonly placeNormally: (window: Placing) => Promise<void>,
    private readonly now: () => number = Date.now,
    /** The processes a window's client belongs to: its own, then its parent's (app-menus' `ownerPids`). */
    private readonly owners: (pid: number | null) => readonly number[] = (pid) => (pid === null ? [] : [pid]),
  ) {}

  /** The window that comes with `title` hangs from `parent` (a portal parent handle). */
  expect(title: string, parent: string): boolean {
    const handle = parseParentWindow(parent);
    if (!handle) return false;
    this.forgetOld();
    if (this.pending.size >= MAX_PENDING) return false;
    this.pending.set(title, { parent: handle, until: this.now() + EXPECT_MS });
    return true;
  }

  /** Whether this new window is an expected sheet; if so the shell places it here, not the Arranger. */
  claim(window: Placing): boolean {
    if (window.appId !== PORTAL_APP_ID) return false;
    this.forgetOld();
    const expected = this.pending.get(window.title);
    if (!expected) return false;
    this.pending.delete(window.title);
    void this.attach(window, expected.parent).catch((error) => {
      console.error("dashi-shell: a portal dialog could not be a sheet:", error instanceof Error ? error.message : error);
      return this.placeNormally(window);
    });
    return true;
  }

  private async attach(window: Placing, handle: string): Promise<void> {
    const own = ownWindowPid(handle);
    const listed = await this.host.windows().catch(() => []);
    const parent = own === null ? await this.host.windowForHandle({ handle }) : ownWindowOf(own, listed, this.owners);
    if (parent === null) return this.placeNormally(window);
    const parentWindow = listed.find((each) => each.id === parent);
    const top = parentWindow ? sheetTop(parentWindow) : undefined;
    await this.host.attach({ window: window.id, parent, ...(top === undefined ? {} : { top }) });
  }

  private forgetOld(): void {
    const now = this.now();
    for (const [title, expected] of this.pending) if (expected.until < now) this.pending.delete(title);
  }
}
