/**
 * dashi-portal's dialogs as sheets: before it opens a dialog, the portal
 * says which window it is for (`ExpectSheet`, protocol.ts); when that window
 * asks to be placed, the shell finds the parent the handle names (IPC
 * `window-for-handle`) and attaches the dialog to it (IPC `attach`, the
 * compositor keeps it there). A handle that names no window leaves the
 * dialog an ordinary window, placed as any other (arrange.ts).
 */

import type { Placing } from "../compositor.ts";
import { PORTAL_APP_ID, parseParentWindow } from "./protocol.ts";

/** An expectation older than this is forgotten: the portal's window never came. */
const EXPECT_MS = 15_000;
const MAX_PENDING = 32;

export interface SheetHost {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** The window id in a `window-for-handle` answer, or null. */
export function parseHandleAnswer(answer: unknown): number | null {
  if (typeof answer !== "object" || answer === null) return null;
  const { window } = answer as { window?: unknown };
  return typeof window === "number" && Number.isInteger(window) && window > 0 ? window : null;
}

export class PortalSheets {
  private readonly pending = new Map<string, { parent: string; until: number }>();

  constructor(
    private readonly host: SheetHost,
    /** Places a window that is not a sheet after all (the Arranger). */
    private readonly placeNormally: (window: Placing) => Promise<void>,
    private readonly now: () => number = Date.now,
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
    const parent = parseHandleAnswer(await this.host.request("window-for-handle", { handle }));
    if (parent === null) return this.placeNormally(window);
    await this.host.request("attach", { window: window.id, parent });
  }

  private forgetOld(): void {
    const now = this.now();
    for (const [title, expected] of this.pending) if (expected.until < now) this.pending.delete(title);
  }
}
