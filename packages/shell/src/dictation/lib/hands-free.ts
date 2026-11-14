/**
 * Hands-free (dictation.ts): a double tap of the dictation key. The
 * microphone stays open with no key held; each sentence lands at the pause
 * after it, and the next is listened for. It ends on a tap, when another
 * window takes the keyboard, after twenty seconds of quiet, or at its time
 * limit, and never silently: a short sound, and a line that stays.
 */

import { maybe } from "@dashi/shape";
import { DICTATION_LIMITS, type DictationPhase, type DictationState, type DictationTrouble } from "../../shared/pill/index.ts";
import type { Timers } from "../../shared/time/index.ts";
import type { DictationDeps, Front, HearingEvent } from "../types.ts";
import { HeardText } from "./heard.ts";
import { land } from "./land.ts";
import { troubleOf } from "./lines.ts";

/** A pause this long ends a sentence. */
export const SENTENCE_QUIET_MS = 1200;

export interface HandsFreeHost {
  show(state: DictationState): void;
  notice(trouble: DictationTrouble, handsFree: boolean): void;
  /** What stops the microphone from opening, or null. */
  ready(at: Front | null): Promise<DictationTrouble | null>;
  phase(): DictationPhase;
}

export class HandsFree {
  running = false;
  private turn = 0;
  private at: Front | null = null;
  private endsAt = 0;
  private sentences = 0;
  private text = "";
  private quiet: unknown = null;
  private limit: unknown = null;

  constructor(
    private readonly deps: DictationDeps & { timers: Timers },
    private readonly host: HandsFreeHost,
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private stopTimers(): void {
    for (const timer of [this.quiet, this.limit]) if (timer !== null) this.deps.timers.clear(timer);
    this.quiet = null;
    this.limit = null;
  }

  private rearmQuiet(): void {
    if (this.quiet !== null) this.deps.timers.clear(this.quiet);
    this.quiet = this.deps.timers.set(() => void this.end("ended"), DICTATION_LIMITS.handsFreeQuiet);
  }

  async start(front: Promise<Front | null>): Promise<void> {
    const turn = ++this.turn;
    this.running = true;
    this.sentences = 0;
    this.host.show({ phase: "opening" });
    this.at = await front;
    const trouble = await this.host.ready(this.at);
    if (turn !== this.turn) return;
    if (trouble) {
      this.running = false;
      return this.host.notice(trouble, false);
    }
    this.endsAt = this.now() + DICTATION_LIMITS.handsFree;
    this.limit = this.deps.timers.set(() => void this.end("limit"), DICTATION_LIMITS.handsFree);
    await this.listen(turn);
  }

  /** Listen for the next sentence: the service ends it at the pause. */
  private async listen(turn: number): Promise<void> {
    const language = this.deps.language;
    try {
      await this.deps.service.call("listen", { until: "silence", quiet_ms: SENTENCE_QUIET_MS, ...(language ? { language } : {}) });
    } catch (error) {
      if (turn !== this.turn) return;
      this.running = false;
      this.stopTimers();
      if (this.sentences > 0) this.deps.chime();
      return this.host.notice(troubleOf(error), true);
    }
    if (turn !== this.turn) return void this.deps.service.call("listen.cancel").catch(() => {});
    this.text = "";
    this.host.show({ phase: "listening", text: "", handsFree: true, endsAt: this.endsAt, hint: null });
    this.rearmQuiet();
  }

  event(event: HearingEvent): void {
    if (!this.running) return;
    if (event.event === "level" && "level" in event) this.deps.hub.level.set(event.level);
    if (event.event === "partial" && "text" in event && this.host.phase() === "listening") {
      this.text = event.text;
      this.host.show({ phase: "listening", text: event.text, handsFree: true, endsAt: this.endsAt, hint: null });
      this.rearmQuiet();
      void this.watch();
    }
    if (event.event === "heard" && "text" in event) void this.sentence(event.text);
    if (event.event === "error") void this.end("ended");
  }

  /** Another window took the keyboard: hands-free is over. */
  private async watch(): Promise<void> {
    const at = this.at;
    if (!at) return;
    const front = await this.deps.front();
    if (this.running && front?.window !== at.window) void this.end("ended");
  }

  /** A sentence ended at its pause: it lands, and the next is listened for. */
  private async sentence(heard: string): Promise<void> {
    const turn = this.turn;
    const words = heard.trim();
    if (words === "") return this.listen(turn);
    this.rearmQuiet();
    const landing = await land(this.deps, words, this.at);
    if (turn !== this.turn) return;
    if (!landing.typed) {
      // Nowhere to type any more: the words wait, and hands-free is over.
      this.turn++;
      this.running = false;
      this.stopTimers();
      this.deps.chime();
      return this.host.show(landing.state);
    }
    this.sentences++;
    await this.listen(turn);
  }

  /** It ends, heard: what was being said lands, a short sound, and a line that says why. */
  async end(trouble: "ended" | "limit"): Promise<void> {
    if (!this.running) return;
    this.turn++;
    this.running = false;
    this.stopTimers();
    let text = "";
    if (this.host.phase() === "listening") {
      const reply = await this.deps.service.call("listen.stop").catch(() => null);
      text = maybe(HeardText, reply)?.text.trim() ?? "";
    } else {
      void this.deps.service.call("listen.cancel").catch(() => {});
    }
    this.deps.chime();
    if (text !== "") {
      const landing = await land(this.deps, text, this.at);
      if (!landing.typed) return this.host.show(landing.state);
    }
    this.host.notice(trouble, true);
  }

  /** Stopped with nothing more said or typed (the lock, Close). */
  drop(): void {
    if (!this.running) return;
    this.turn++;
    this.running = false;
    this.stopTimers();
    void this.deps.service.call("listen.cancel").catch(() => {});
  }
}
