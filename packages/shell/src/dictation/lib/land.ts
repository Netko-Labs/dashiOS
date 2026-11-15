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
import type { LexiconView } from "../lexicon.ts";
import type { DictationDeps, FieldRead, Front } from "../types.ts";
import type { Words } from "../words.ts";
import { type Composed, type Composing, compose, namesOf } from "./compose.ts";
import { fit } from "./fit.ts";
import { landedLine, waitingLine } from "./lines.ts";
import { type Place, pickProfile } from "./profiles.ts";
import { type Insertion, type Insertions, insertionId } from "./record.ts";
import { type Asking, correct, reasonsFor } from "./rewrite.ts";
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
  /** The rules' words landed and the model is still to be asked: what to ask it (landings.ts replaces the words when it answers). */
  refine?: Asking;
}

/** What is typed for the tidied words: a space after them, so the next words (said or typed) do not join them; none after a line break. */
export const withSpace = (typed: string): string => (typed.endsWith("\n") ? typed : `${typed} `);

/** Where the words can go: the window and its field, or why they can't. */
type Spot = { front: Front; field: FieldRead | null } | WaitReason;

async function placeFor(deps: DictationDeps, { at, since }: Meant): Promise<Spot> {
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
function remember(deps: DictationDeps, kept: Insertions, entry: Omit<Insertion, "id" | "at">, model: string): Insertion {
  const now = deps.now?.() ?? Date.now();
  const whole: Insertion = { ...entry, id: insertionId(now), at: now };
  kept.push(whole);
  const said = model ? { model } : {};
  deps.history?.add({ id: whole.id, at: now, app: whole.app, profile: whole.profile, heard: whole.heard, typed: whole.text, ...said });
  return whole;
}

/** What every landing reads: the person's words and profiles, the dictionary, and the profile they chose for a window. */
export interface LandContext {
  kept: Insertions;
  lexicon(): LexiconView;
  words: Words;
  chosen(window: number): string | undefined;
}

function waiting(deps: DictationDeps, made: Composed, reason: WaitReason): Landing {
  const now = deps.now?.() ?? Date.now();
  return {
    typed: false,
    entry: null,
    state: { phase: "waiting", text: made.text, heard: made.heard, reason, line: waitingLine(reason), until: now + DICTATION_LIMITS.waiting },
  };
}

function landed(deps: DictationDeps, made: Composed, how: "typed" | "pasted", entry: Insertion | null, profile: string): Landing {
  const now = deps.now?.() ?? Date.now();
  return {
    typed: true,
    entry,
    state: {
      phase: "landed",
      typed: made.text,
      heard: made.heard,
      changes: made.changes,
      line: landedLine(made.changes, how, made.asHeard),
      until: now + DICTATION_LIMITS.landed,
      undo: entry !== null,
      raw: entry !== null && made.text !== made.heard,
      ...(profile ? { profile } : {}),
    },
  };
}

/** The profile of the place in front, and whether an agent's prompt runs in its terminal. */
export async function placeOf(deps: DictationDeps, ctx: LandContext, front: Front | null, field: FieldRead | null): Promise<{ place: Place; agent: boolean }> {
  const place = pickProfile(ctx.lexicon().profiles, front, field, front ? ctx.chosen(front.window) : undefined);
  const agent = place.terminal && front !== null && ((await deps.terminalAgent?.(front).catch(() => false)) ?? false);
  return { place, agent };
}

/** The chord a line break is typed as there, or null for Return itself. */
function breaksFor(place: Place, agent: boolean): string | null {
  if (place.terminal) return agent ? "ctrl+j" : null;
  return place.profile.breaks === "soft" ? "shift+Return" : null;
}

/** Characters into the window in front, remembered; `text` is what the history calls them. */
export async function typeAndRemember(
  deps: DictationDeps,
  kept: Insertions,
  where: { front: Front; field: FieldRead | null },
  what: { heard: string; text: string; typed: string; profile: string; breaks: string | null; model?: string },
): Promise<{ how: Typed; entry: Insertion | null }> {
  const how = await typeInto(deps, where.front.window, what.typed, what.breaks);
  if (how !== "typed" && how !== "pasted") return { how, entry: null };
  const entry = remember(
    deps,
    kept,
    {
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
      breaks: what.breaks,
    },
    what.model ?? "",
  );
  return { how, entry };
}

/** The window and field the words would go to now, or why they can't. */
export const spotFor = placeFor;

/** The chord a line break is typed as in `front`'s field, or null for Return itself. */
export async function breaksIn(
  deps: DictationDeps,
  ctx: LandContext,
  front: Front,
  field: FieldRead | null,
): Promise<{ breaks: string | null; profile: string }> {
  const { place, agent } = await placeOf(deps, ctx, front, field);
  return { breaks: breaksFor(place, agent), profile: place.profile.name };
}

export async function land(deps: DictationDeps, ctx: LandContext, heard: string, meant: Meant): Promise<Landing> {
  const { hub } = deps;
  const lexicon = ctx.lexicon();
  const composing = { lexicon, words: ctx.words, tidy: deps.prefs().tidy };
  // The bar's row is the field: the words are its, at its caret, as Writing has them.
  if (hub.bar.getSnapshot().mode === "field") {
    const made = compose(heard, { ...composing, ...(await placeOf(deps, ctx, null, null)) });
    if (hub.barCommands.send({ do: "insert", text: withSpace(made.text) })) return landed(deps, made, "typed", null, "");
  }
  const where = await placeFor(deps, meant);
  if (typeof where === "string") return waiting(deps, compose(heard, { ...composing, ...(await placeOf(deps, ctx, null, null)) }), where);
  const { place, agent } = await placeOf(deps, ctx, where.front, where.field);
  const full: Composing = { ...composing, place, agent };
  const rules = compose(heard, full);
  // The gate, then the model where it is needed and can be waited for; else the rules' words.
  const asking: Asking = { made: rules, composing: full, before: where.field?.before ?? "", reasons: reasonsFor(rules, full) };
  const { made, refine, model } = await correct(deps, asking);
  // The words continue what the field holds: a space, a capital and a full stop only where they belong (fit.ts).
  const fitted = fit(made.text, where.field, { words: ctx.words, names: namesOf(made.terms) });
  const fits: Composed = { ...made, text: fitted.text };
  const what = { heard: made.heard, text: fitted.text, typed: fitted.typed, profile: place.profile.name, breaks: breaksFor(place, agent), model };
  const { how, entry } = await typeAndRemember(deps, ctx.kept, where, what);
  if (how !== "typed" && how !== "pasted") return waiting(deps, made, how);
  return { ...landed(deps, fits, how, entry, place.profile.name), ...(refine && entry ? { refine: asking } : {}) };
}
