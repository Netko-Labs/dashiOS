/**
 * Landing the words (dictation.ts): tidied by rule, then typed into the
 * field that has the keyboard as one step, and remembered (record.ts,
 * history.ts). While the bar's row is the field they go to it. Where typing
 * can't be done (an X11 window) they are pasted, and the line says so.
 * Where there is nothing to type into, or the window changed, or a password
 * field has the keyboard, nothing is typed: the words wait with Copy. The
 * same when the person clicked or pressed a key in the window after they
 * stopped speaking (`since`): no app tells one field from another well
 * enough (the same field serves the next conversation), so the words are
 * not given to wherever the caret went (decisions.md D81).
 */

import { DICTATION_LIMITS, type DictationState, type WaitReason } from "../../shared/pill/index.ts";
import type { DictationDeps, FieldRead, Front } from "../types.ts";
import { landedLine, waitingLine } from "./lines.ts";
import { type Insertion, type Insertions, insertionId } from "./record.ts";
import { type Tidied, tidy } from "./tidy.ts";
import { type Typed, typeInto } from "./type.ts";

/** A press this little before `since` counts as after it: the shell hears the key come up a moment late. */
const MOVED_SLACK_MS = 60;

/**
 * How long the landing waits to hear what field has the keyboard. The first check of a session connects
 * to the accessibility bus and can take seconds (decisions.md D122): past this the words are typed, as
 * they are when the bus can't be reached at all.
 */
const FIELD_CHECK_MS = 1500;

/** The field with the keyboard in `front`; null when that is not known in time. */
export function fieldIn(deps: DictationDeps, front: Front): Promise<FieldRead | null> {
  const timers = deps.timers;
  if (!timers) return deps.field(front).catch(() => null);
  return new Promise((resolve) => {
    const timer = timers.set(() => resolve(null), FIELD_CHECK_MS);
    const known = (field: FieldRead | null): void => {
      timers.clear(timer);
      resolve(field);
    };
    deps.field(front).then(known, () => known(null));
  });
}

/** Where the words belong: the window the listen began in (null: wherever the keyboard is now), and when the person stopped (null: not known). */
export interface Meant {
  at: Front | null;
  since: number | null;
}

/** Whether the person's own hands pressed something in the window since they stopped speaking. */
async function moved(deps: DictationDeps, window: number, since: number | null): Promise<boolean> {
  if (since === null) return false;
  const ago = await deps.pressed(window).catch(() => null);
  if (ago === null) return false;
  const now = deps.now?.() ?? Date.now();
  return ago <= now - since + MOVED_SLACK_MS;
}

export interface Landing {
  state: DictationState;
  typed: boolean;
  /** What was remembered of it, when it was typed into a window. */
  entry: Insertion | null;
}

/** What is typed for the tidied words: a space after them, so the next words (said or typed) do not join them; none after a line break. */
export const withSpace = (typed: string): string => (typed.endsWith("\n") ? typed : `${typed} `);

/** Where the words can go: the window and its field, or why they can't. */
type Place = { front: Front; field: FieldRead | null } | WaitReason;

async function placeFor(deps: DictationDeps, { at, since }: Meant): Promise<Place> {
  const front = await deps.front();
  if (!front) return "no-field";
  if (at && front.window !== at.window) return "left-window";
  const field = await fieldIn(deps, front);
  if (field?.kind === "password") return "secret";
  if (await moved(deps, front.window, since)) return "moved";
  return { front, field };
}

const fieldWords = (field: FieldRead | null): string => (field ? (field.site ? `${field.role} on ${field.site}` : field.role) : "");

/** What landed, remembered: on the stack for Undo, and in the history. */
function remember(deps: DictationDeps, kept: Insertions, entry: Omit<Insertion, "id" | "at">): Insertion {
  const now = deps.now?.() ?? Date.now();
  const whole: Insertion = { ...entry, id: insertionId(now), at: now };
  kept.push(whole);
  deps.history?.add({ id: whole.id, at: now, app: whole.app, profile: whole.profile, heard: whole.heard, typed: whole.text });
  return whole;
}

function waiting(deps: DictationDeps, tidied: Tidied, reason: WaitReason): Landing {
  const now = deps.now?.() ?? Date.now();
  return {
    typed: false,
    entry: null,
    state: { phase: "waiting", text: tidied.typed, heard: tidied.heard, reason, line: waitingLine(reason), until: now + DICTATION_LIMITS.waiting },
  };
}

function landed(deps: DictationDeps, tidied: Tidied, how: "typed" | "pasted", entry: Insertion | null): Landing {
  const now = deps.now?.() ?? Date.now();
  return {
    typed: true,
    entry,
    state: {
      phase: "landed",
      typed: tidied.typed,
      heard: tidied.heard,
      changes: tidied.changes,
      line: landedLine(tidied.changes, how, tidied.asHeard),
      until: now + DICTATION_LIMITS.landed,
      undo: entry !== null,
      raw: entry !== null && tidied.typed !== tidied.heard,
    },
  };
}

/** Characters into the window in front, remembered; `text` is what the history calls them. */
export async function typeAndRemember(
  deps: DictationDeps,
  kept: Insertions,
  where: { front: Front; field: FieldRead | null },
  what: { heard: string; text: string; typed: string; profile: string; soft: boolean },
): Promise<{ how: Typed; entry: Insertion | null }> {
  const how = await typeInto(deps, where.front.window, what.typed, what.soft);
  if (how !== "typed" && how !== "pasted") return { how, entry: null };
  const entry = remember(deps, kept, {
    window: where.front.window,
    pid: where.front.pid,
    app: deps.appName?.(where.front) ?? where.front.appId ?? "",
    field: fieldWords(where.field),
    heard: what.heard,
    text: what.text,
    typed: what.typed,
    how,
    profile: what.profile,
    readable: where.field !== null && where.field.before !== null,
    soft: what.soft,
  });
  return { how, entry };
}

export async function land(deps: DictationDeps, kept: Insertions, heard: string, meant: Meant): Promise<Landing> {
  const tidied: Tidied = tidy(heard, deps.prefs().tidy);
  const { hub } = deps;
  // The bar's row is the field: the words are its, at its caret.
  if (hub.bar.getSnapshot().mode === "field" && hub.barCommands.send({ do: "insert", text: withSpace(tidied.typed) })) {
    return landed(deps, tidied, "typed", null);
  }
  const where = await placeFor(deps, meant);
  if (typeof where === "string") return waiting(deps, tidied, where);
  const what = { heard: tidied.heard, text: tidied.typed, typed: withSpace(tidied.typed), profile: "", soft: false };
  const { how, entry } = await typeAndRemember(deps, kept, where, what);
  if (how !== "typed" && how !== "pasted") return waiting(deps, tidied, how);
  return landed(deps, tidied, how, entry);
}
