/**
 * Every landing of a session (dictation.ts): the words go to the field
 * (land.ts), are remembered (record.ts), and stay Dashi's to take back,
 * change to the raw words, or type again (after.ts).
 */

import type { DictationState } from "../../shared/pill/index.ts";
import type { DictationDeps } from "../types.ts";
import { pasteLast, raw, undo } from "./after.ts";
import { type Landing, land, type Meant } from "./land.ts";
import { Insertions } from "./record.ts";

export class Landings {
  /** What Dashi typed, the newest last. */
  readonly kept = new Insertions();
  /** The last dictation's words, landed or not, and what was remembered of it. */
  private last: { heard: string; text: string; entry: string | null } | null = null;

  constructor(private readonly deps: DictationDeps) {}

  private sawState(state: DictationState, entry: string | null): void {
    if (state.phase === "landed") this.last = { heard: state.heard, text: state.typed, entry };
    if (state.phase === "waiting") this.last = { heard: state.heard, text: state.text, entry: null };
  }

  /** The words land, and are the last dictation from now on. */
  async land(heard: string, meant: Meant): Promise<Landing> {
    const landing = await land(this.deps, this.kept, heard, meant);
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
