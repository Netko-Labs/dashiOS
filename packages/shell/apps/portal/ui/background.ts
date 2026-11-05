/**
 * A question from an app with no window (the portal got no parent): rather
 * than a window popping up out of nowhere, an item waits in the menu bar
 * (an applet, docs/applets.md) and a click on it opens the sheet as a window
 * of its own. The item goes when the question is answered or withdrawn.
 */

import type { AppletsClient } from "../../kit/applet.ts";

export interface Waiting {
  id: string;
  /** What the item says beside its glyph: the app's name. */
  label: string;
  /** The tooltip and the item's name: "Helium wants to use the camera". */
  title: string;
  glyph: string;
}

/** Runs `ask` once the person clicks the item; resolves with its answer, or `closed` when `signal` aborts first. */
export function askFromMenuBar<T>(applets: AppletsClient, waiting: Waiting, ask: () => Promise<T>, signal: AbortSignal, closed: T): Promise<T> {
  if (!applets.available) return ask();
  return new Promise<T>((resolve) => {
    let asking = false;
    const done = (value: T) => {
      signal.removeEventListener("abort", onAbort);
      applets.remove(waiting.id);
      resolve(value);
    };
    const onAbort = () => {
      if (!asking) done(closed);
    };
    signal.addEventListener("abort", onAbort);
    applets.show(
      { id: waiting.id, title: waiting.title, tooltip: waiting.title, glyph: waiting.glyph, label: waiting.label, click: "activate", attention: true },
      {
        onActivate: () => {
          if (asking) return;
          asking = true;
          applets.remove(waiting.id);
          void ask().then(done, () => done(closed));
        },
      },
    );
  });
}
