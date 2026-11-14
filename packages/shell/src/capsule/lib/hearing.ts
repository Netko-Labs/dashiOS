/**
 * The card's turn with the voice loop: say some words, and take the next
 * thing heard as the card's answer. The voice loop has one question at a
 * time (voice/voice.ts `ask`), so there is one of these.
 */

import type { Timers } from "../../shared/time/index.ts";
import type { VoiceSource } from "./sources.ts";

export class Hearing {
  private end: (() => void) | null = null;

  constructor(
    private readonly voice: VoiceSource | null,
    private readonly timers: Timers,
  ) {}

  /**
   * Say `words` and give the next thing heard to `heard`, while `still()`
   * holds. A moment later, not now: the voice loop is still handing the
   * plan over, and taking its turn here would stop the task
   * (voice/voice.ts `halt`).
   */
  start(words: string, still: () => boolean, heard: (text: string) => void): void {
    const voice = this.voice;
    if (!voice) return;
    this.stop();
    let release: (() => void) | null = null;
    const timer = this.timers.set(() => {
      if (still()) release = voice.ask(words, (text) => still() && heard(text));
    }, 0);
    this.end = () => {
      this.timers.clear(timer);
      release?.();
    };
  }

  stop(): void {
    this.end?.();
    this.end = null;
  }
}
