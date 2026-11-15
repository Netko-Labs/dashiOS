/**
 * Every landing of a session (dictation.ts): the words go to the field
 * (land.ts), are remembered (record.ts), and stay Dashi's to take back,
 * change to the raw words, or type again (after.ts).
 */

import type { DictationState } from "../../shared/pill/index.ts";
import { Lexicon } from "../lexicon.ts";
import type { DictationDeps, Front } from "../types.ts";
import { NO_WORDS } from "../words.ts";
import { entryTyped, pasteLast, raw, told, typeAgain, undo } from "./after.ts";
import { erase } from "./erase.ts";
import { fieldIn, type LandContext, type Landing, land, type Meant, placeOf } from "./land.ts";
import { nextProfile } from "./profiles.ts";
import { type Insertion, Insertions } from "./record.ts";
import { type Asking, requestFor, usable, withModel } from "./rewrite.ts";

/** A lexicon nobody gave (a test): Dashi's own profiles and words, nothing read or written. */
const ownLexicon = (): Lexicon => new Lexicon({ memory: true });

export class Landings {
  /** What Dashi typed, the newest last. */
  readonly kept = new Insertions();
  /** The last dictation's words, landed or not, and what was remembered of it. */
  private last: { heard: string; text: string; entry: string | null } | null = null;

  /** The profile the person chose for a window, until it closes. */
  private readonly chosen = new Map<number, string>();
  private readonly lexicon: Lexicon;
  private readonly ctx: LandContext;

  /** The model's answer that is still awaited for words that landed already; aborted when they are taken back or others land. */
  private refining: AbortController | null = null;

  constructor(
    private readonly deps: DictationDeps,
    /** The capsule's line, when words that landed were replaced by the model's. */
    private readonly show: (state: DictationState) => void = () => {},
  ) {
    this.lexicon = deps.lexicon ?? ownLexicon();
    this.ctx = {
      kept: this.kept,
      lexicon: () => this.lexicon.getSnapshot(),
      words: deps.words ?? NO_WORDS,
      chosen: (window) => this.chosen.get(window),
    };
  }

  /** The key went down: the person's files are read again if one changed, and the model is asked to be ready. */
  refresh(): void {
    this.lexicon.refresh();
    this.deps.rewriter?.warm();
  }

  /** Whatever the model was still to answer is no longer wanted. */
  private settle(): void {
    this.refining?.abort();
    this.refining = null;
  }

  /**
   * The rules' words landed; the model answers later (a machine too slow to wait on). Its words take their place only
   * if the field still ends with them: the same check as Undo.
   */
  private async refine(entry: Insertion, asking: Asking): Promise<void> {
    const { rewriter } = this.deps;
    if (!usable(rewriter)) return;
    const refining = new AbortController();
    this.refining = refining;
    const reply = await rewriter.rewrite(requestFor(this.deps, asking, rewriter.advice(asking.made.text).deadlineMs, refining.signal)).catch(() => null);
    if (refining.signal.aborted || this.refining !== refining) return;
    this.refining = null;
    if (reply?.kind !== "text") return;
    const made = withModel(asking.made, reply.text, asking.composing);
    if (made.text === entry.text || this.kept.top(entry.window)?.id !== entry.id) return;
    if ((await erase(this.deps, entry)) !== "erased") return;
    this.kept.drop(entry.id);
    this.deps.history?.mark(entry.id, "refined");
    const state = await typeAgain(this.deps, this.kept, { ...entry, text: made.text, typed: entryTyped(entry, made.text) }, "Refined.");
    this.sawState(state, this.kept.top()?.id ?? null);
    this.show(state.phase === "landed" ? { ...state, raw: true } : state);
  }

  /** The name of the profile for the window in front ("Developer"); "" when it can't be told. */
  async profileName(front: Front | null): Promise<string> {
    if (!front) return "";
    const field = await fieldIn(this.deps, front);
    return (await placeOf(this.deps, this.ctx, front, field)).place.profile.name;
  }

  /** A press on the profile's name: the next one, for the window in front, until it closes. */
  async nextProfile(): Promise<DictationState> {
    const front = await this.deps.front().catch(() => null);
    if (!front) return told(this.deps, "No window to choose a profile for.", "warn");
    const field = await fieldIn(this.deps, front);
    const { place } = await placeOf(this.deps, this.ctx, front, field);
    const next = nextProfile(this.lexicon.getSnapshot().profiles, place.profile.id);
    if (!next) return told(this.deps, "There is no other profile.", "warn");
    this.chosen.set(front.window, next.id);
    return told(this.deps, `${next.name}. For this window.`);
  }

  private sawState(state: DictationState, entry: string | null): void {
    if (state.phase === "landed") this.last = { heard: state.heard, text: state.typed, entry };
    if (state.phase === "waiting") this.last = { heard: state.heard, text: state.text, entry: null };
  }

  /** The words land, and are the last dictation from now on. */
  async land(heard: string, meant: Meant): Promise<Landing> {
    this.settle();
    const landing = await land(this.deps, this.ctx, heard, meant);
    this.sawState(landing.state, landing.entry?.id ?? null);
    if (landing.refine && landing.entry) void this.refine(landing.entry, landing.refine);
    return landing;
  }

  private async seen(state: Promise<DictationState>): Promise<DictationState> {
    const next = await state;
    this.sawState(next, this.kept.top()?.id ?? null);
    return next;
  }

  undo(): Promise<DictationState> {
    this.settle();
    return this.seen(undo(this.deps, this.kept));
  }

  raw(): Promise<DictationState> {
    this.settle();
    return this.seen(raw(this.deps, this.kept, this.last?.entry ?? null));
  }

  pasteLast(): Promise<DictationState> {
    return this.seen(pasteLast(this.deps, this.kept, this.last));
  }
}
