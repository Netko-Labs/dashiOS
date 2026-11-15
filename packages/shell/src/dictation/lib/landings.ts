/**
 * Every landing of a session (dictation.ts): the words go to the field
 * (land.ts), are remembered (record.ts), and stay Dashi's to take back,
 * change to the raw words, or type again (after.ts).
 */

import type { DictationState } from "../../shared/pill/index.ts";
import { Lexicon } from "../lexicon.ts";
import type { DictationDeps, Front } from "../types.ts";
import { NO_WORDS } from "../words.ts";
import { pasteLast, raw, told, undo } from "./after.ts";
import { fieldIn, type LandContext, type Landing, land, type Meant, placeOf } from "./land.ts";
import { nextProfile } from "./profiles.ts";
import { Insertions } from "./record.ts";

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

  constructor(private readonly deps: DictationDeps) {
    this.lexicon = deps.lexicon ?? ownLexicon();
    this.ctx = {
      kept: this.kept,
      lexicon: () => this.lexicon.getSnapshot(),
      words: deps.words ?? NO_WORDS,
      chosen: (window) => this.chosen.get(window),
    };
  }

  /** The key went down: the person's files are read again if one changed. */
  refresh(): void {
    this.lexicon.refresh();
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
    const landing = await land(this.deps, this.ctx, heard, meant);
    this.sawState(landing.state, landing.entry?.id ?? null);
    return landing;
  }

  private async seen(state: Promise<DictationState>): Promise<DictationState> {
    const next = await state;
    this.sawState(next, this.kept.top()?.id ?? null);
    return next;
  }

  undo(): Promise<DictationState> {
    return this.seen(undo(this.deps, this.kept));
  }

  raw(): Promise<DictationState> {
    return this.seen(raw(this.deps, this.kept, this.last?.entry ?? null));
  }

  pasteLast(): Promise<DictationState> {
    return this.seen(pasteLast(this.deps, this.kept, this.last));
  }
}
