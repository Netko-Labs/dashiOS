/**
 * Before Dashi logs out, restarts, or shuts down from its menus, every app's
 * window is asked to close, as its close control would (design.html PA-4).
 * An app with nothing to lose closes at once; one that holds its window to
 * ask (Text Editor's unsaved changes, a busy Terminal) keeps the session
 * waiting for its answer. After a moment a notice names who holds it, at the
 * foot of the screen, clear of the app's own sheet (menus/holding-place.ts),
 * with Cancel (the session stays) and “Log out anyway” (it goes, as before:
 * apps still open are told to stop, and a hung one is ended). When the last
 * window goes, the session ends without another word.
 *
 * The lock screen's power buttons don't wait: nobody can answer an app's
 * question behind it.
 */

import type { PowerKind } from "./menus/model.ts";

/** One app window to close: its toplevel id and its app's name. */
export interface AppWindow {
  id: number;
  name: string;
}

/** How long the apps get before the sheet names who is holding things up. */
export const HOLD_AFTER_MS = 1000;
const POLL_MS = 150;

export type ClosingAnswer = "cancel" | "anyway";

export interface ClosingDeps {
  /** The apps' windows now (the shell's own left out). */
  windows(): Promise<AppWindow[]>;
  /** Asks one window to close (the compositor's `close`, xdg_toplevel.close). */
  close(window: number): Promise<void>;
  /** Some windows haven't closed: show (or update) the sheet naming their apps, and bring the first forward. */
  holding(names: readonly string[], first: number): void;
  /** The wait is over (closed, cancelled, or gone anyway): take the sheet down. */
  done(): void;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

/** The person's answer on the sheet, set from its buttons; read by the wait. */
export class ClosingChoice {
  answer: ClosingAnswer | null = null;
}

/**
 * Asks every app window to close and waits for them. Resolves `closed` when
 * they all went, else the person's answer on the sheet.
 */
export async function closeApps(deps: ClosingDeps, choice: ClosingChoice): Promise<"closed" | ClosingAnswer> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const asked = await deps.windows().catch(() => []);
  const ids = new Set(asked.map((window) => window.id));
  for (const window of asked) await deps.close(window.id).catch(() => {});
  const started = now();
  let shown = "";
  try {
    for (;;) {
      const left = (await deps.windows().catch(() => [])).filter((window) => ids.has(window.id));
      if (left.length === 0) return "closed";
      if (choice.answer) return choice.answer;
      const names = [...new Set(left.map((window) => window.name))];
      const key = names.join("\n");
      if (now() - started >= HOLD_AFTER_MS && key !== shown) {
        // Shown once, then again only when who holds it changes.
        const first = left[0] as AppWindow;
        deps.holding(names, first.id);
        shown = key;
      }
      await sleep(POLL_MS);
    }
  } finally {
    if (shown) deps.done();
  }
}

/**
 * The notice's words: who it waits for, and what the button that goes anyway
 * says. An app may hold for unsaved changes or for a running job (Terminal),
 * so the words say only that it may be asking.
 */
export function holdingCopy(names: readonly string[], what: PowerKind): { title: string; detail: string; anyway: string } {
  const who = names.length === 1 ? `“${names[0]}”` : names.length === 2 ? `“${names[0]}” and “${names[1]}”` : `${names.length} apps`;
  const anyway = { logout: "Log out anyway", restart: "Restart anyway", shutdown: "Shut down anyway" }[what];
  const asks = names.length === 1 ? "It may be asking first." : "They may be asking first.";
  return { title: `Waiting for ${who} to close`, detail: asks, anyway };
}
