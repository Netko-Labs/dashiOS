/**
 * Before Dashi logs out, restarts, or shuts down from its menus, every app's
 * window is asked to close, as its close control would (design.html PA-4),
 * one at a time: the next is asked only once the last one has gone, so two
 * apps' questions are never up together. An app with nothing to lose closes
 * at once; one that holds its window to ask (Text Editor's unsaved changes,
 * a busy Terminal) keeps the session waiting for its answer, and only then
 * is the next asked. After a moment a notice names who holds it, at the
 * foot of the screen, clear of the app's own sheet (menus/lib/holding-place.ts),
 * with Cancel (the session stays, and the app asking is told so: its
 * question goes, kit/close.ts) and “Log out anyway” (it goes, as before:
 * apps still open are told to stop, and a hung one is ended). When the last
 * window goes, the session ends without another word.
 *
 * The lock screen's power buttons don't wait: nobody can answer an app's
 * question behind it.
 */

import type { PowerKind } from "./menus/index.ts";

/** One app window to close: its toplevel id and its app's name. */
export interface AppWindow {
  id: number;
  name: string;
}

/** How long the apps get before the sheet names who is holding things up. */
export const HOLD_AFTER_MS = 1000;
/** How often the wait looks for the asked window to be gone: often, since the windows are asked in turn. */
const POLL_MS = 50;

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
  /** Cancelled: the window asked last is no longer closing, so the question its app put up goes. */
  withdraw?(window: number): void;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

/** The person's answer on the sheet, set from its buttons; read by the wait. */
export class ClosingChoice {
  answer: ClosingAnswer | null = null;
}

/**
 * Asks the app windows to close, one at a time, each once the one before
 * has gone, and waits for them. Resolves `closed` when they all went, else
 * the person's answer on the notice.
 */
export async function closeApps(deps: ClosingDeps, choice: ClosingChoice): Promise<"closed" | ClosingAnswer> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const ids = new Set((await deps.windows().catch(() => [])).map((window) => window.id));
  const started = now();
  let shown = "";
  /** The window asked last, which has not gone yet. */
  let asking: number | null = null;
  try {
    for (;;) {
      const left = (await deps.windows().catch(() => [])).filter((window) => ids.has(window.id));
      if (left.length === 0) return "closed";
      if (choice.answer === "cancel" && asking !== null && left.some((window) => window.id === asking)) deps.withdraw?.(asking);
      if (choice.answer) return choice.answer;
      if (asking === null || !left.some((window) => window.id === asking)) {
        // The last one went (or none was asked yet): ask the next.
        asking = (left[0] as AppWindow).id;
        await deps.close(asking).catch(() => {});
      }
      // The one asked first: it is the one that may be asking.
      const held = [...left.filter((window) => window.id === asking), ...left.filter((window) => window.id !== asking)];
      const names = [...new Set(held.map((window) => window.name))];
      const key = `${asking}\n${names.join("\n")}`;
      if (now() - started >= HOLD_AFTER_MS && key !== shown) {
        // Shown once, then again only when who holds it changes.
        deps.holding(names, asking);
        shown = key;
      }
      await sleep(POLL_MS);
    }
  } finally {
    if (shown) deps.done();
  }
}

/**
 * The most characters the notice's line holds beside Cancel and the widest
 * "… anyway" at 12 px in its 560 px card (menus/lib/holding-place.ts), so it is
 * always one line (VS-3: a notice that wraps reads like a second bar).
 */
export const HOLDING_LINE = 50;

/**
 * The notice's line, naming who it waits for, and what the button that goes
 * anyway says. An app may hold for unsaved changes or for a running job
 * (Terminal), so the words say only that it may be asking. One name that
 * leaves no room for that is named alone (cut if it is too long for the
 * line); two are named alone, or counted when they don't fit.
 */
export function holdingCopy(names: readonly string[], what: PowerKind): { line: string; anyway: string } {
  const anyway = { logout: "Log out anyway", restart: "Restart anyway", shutdown: "Shut down anyway" }[what];
  const fits = (line: string): boolean => line.length <= HOLDING_LINE;
  const [first = "", second = ""] = names;
  if (names.length <= 1) {
    const asking = `Waiting for “${first}”. It may be asking first.`;
    if (fits(asking)) return { line: asking, anyway };
    const room = HOLDING_LINE - "Waiting for “” to close.".length;
    const name = first.length > room ? `${first.slice(0, room - 1).trimEnd()}…` : first;
    return { line: `Waiting for “${name}” to close.`, anyway };
  }
  const both = `Waiting for “${first}” and “${second}” to close.`;
  return { line: names.length === 2 && fits(both) ? both : `Waiting for ${names.length} apps. They may be asking first.`, anyway };
}
