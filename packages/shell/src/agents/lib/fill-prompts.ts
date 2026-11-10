/**
 * After Dashi types a card or a password into a window, the app may show it
 * back: Firefox's "Securely save this card? •••• 4242 12/34" (an xdg_popup),
 * a "Save password?" prompt with a Show button, or a window of its own. So
 * from the fill until a minute after its fields were last seen, agents'
 * pictures blank that window's popups (dashi-comp keeps a popup blanked for
 * as long as it lives) and, whole, every window of the same app opened since
 * the fill, for as long as it lives.
 */

import type { CompositorWindow } from "../../compositor.ts";

/** How long after a filled field was last seen its window's popups stay blanked. */
export const PROMPT_MS = 60_000;

interface Hot {
  seen: number;
  /** The app's windows at the fill (those opened later are blanked whole); null until known. */
  known: Set<number> | null;
}

export class FillPrompts {
  private readonly hot = new Map<number, Hot>();
  private readonly opened = new Set<number>();

  constructor(
    private readonly windows: () => Promise<readonly CompositorWindow[]>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Dashi typed a secret into `window`, or a field it filled there is still around. */
  touched(window: number): void {
    const now = this.now();
    const hot = this.hot.get(window);
    if (hot && now - hot.seen < PROMPT_MS) {
      hot.seen = now;
      return;
    }
    const fresh: Hot = { seen: now, known: null };
    this.hot.set(window, fresh);
    void this.windows()
      .then((all) => {
        fresh.known ??= sameApp(all, window);
      })
      .catch(() => {});
  }

  /** For a mask, from every window there is: whose popups are blanked, and which windows whole. */
  blank(all: readonly CompositorWindow[]): { popups: number[]; windows: number[] } {
    const now = this.now();
    const ids = new Set(all.map((w) => w.id));
    for (const id of this.opened) if (!ids.has(id)) this.opened.delete(id);
    const popups: number[] = [];
    for (const [window, hot] of this.hot) {
      if (now - hot.seen >= PROMPT_MS || !ids.has(window)) {
        this.hot.delete(window);
        continue;
      }
      popups.push(window);
      hot.known ??= sameApp(all, window);
      for (const id of sameApp(all, window)) if (!hot.known.has(id)) this.opened.add(id);
    }
    return { popups, windows: [...this.opened] };
  }
}

/** `window` and the other windows of its app (by pid). */
function sameApp(all: readonly CompositorWindow[], window: number): Set<number> {
  const pid = all.find((w) => w.id === window)?.pid ?? null;
  return new Set([window, ...(pid === null ? [] : all.filter((w) => w.pid === pid).map((w) => w.id))]);
}
