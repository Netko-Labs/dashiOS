/**
 * What Dashi says: the utterance under way (`speak`), its captions in step,
 * and a notice that outlasts it (a failed ask's words stay in the chip while
 * they are said, and a while after). voice.ts decides when; this keeps what
 * is being said and ends it.
 */

import { maybe } from "@dashi/shape";
import type { Chip, ChipGo } from "../types.ts";
import type { VoiceService } from "./service.ts";
import type { Captions } from "./speech.ts";
import { SpeakReply, type SpokenWord } from "./wire.ts";

type Notice = Extract<Chip, { kind: "notice" }>;

/** What saying needs of the voice it is part of. */
export interface SayingHost {
  service: VoiceService;
  captions: Captions;
  /** Dashi's voice as chosen in Settings; its own when none. */
  voice(): string | undefined;
  /** The press this belongs to: a newer one makes it stale. */
  turn(): number;
  show(chip: Chip | null): void;
  notice(text: string, go?: ChipGo, ms?: number): void;
  /** The keys held follow what there is to stop. */
  sync(): void;
}

export class Saying {
  /** The utterance being said (`speak`'s id); `pending` from the ask until the service names it. */
  private utterance: number | "pending" | null = null;
  /** A notice that outlasts the speech said with it. */
  private lasting: Notice | null = null;

  constructor(private readonly host: SayingHost) {}

  /** Something is being said, or about to be. */
  get busy(): boolean {
    return this.utterance !== null;
  }

  /** These words stay in the chip while the next thing is said, and a while after. */
  keep(notice: Notice): void {
    this.lasting = notice;
  }

  /** Say `text` in Dashi's voice (or `voice`), with captions. What can't be said is shown instead. */
  async say(text: string, voice?: string): Promise<void> {
    const { host } = this;
    const turn = host.turn();
    const chosen = voice ?? host.voice();
    this.utterance = "pending";
    if (this.lasting) host.show(this.lasting);
    else host.sync();
    try {
      const reply = maybe(SpeakReply, await host.service.call("speak", { text, ...(chosen ? { voice: chosen } : {}) }));
      if (turn === host.turn() && this.utterance === "pending") this.utterance = reply?.id ?? null;
    } catch {
      if (turn !== host.turn()) return;
      this.utterance = null;
      const lasting = this.lasting;
      this.lasting = null;
      host.notice(lasting?.text ?? text, lasting?.go, 8000);
    }
  }

  /** A sentence's first sound plays now: its caption, unless a failed ask's words hold the chip. */
  sentence(id: number, text: string, words: readonly SpokenWord[]): void {
    if (id === this.utterance && !this.lasting) this.host.captions.sentence(text, words);
  }

  /** An utterance ended by itself: the chip goes, or a failed ask's words stay a while longer. */
  spoken(id: number): void {
    if (id !== this.utterance) return;
    this.host.captions.clear();
    this.utterance = null;
    const lasting = this.lasting;
    this.lasting = null;
    if (lasting) this.host.notice(lasting.text, lasting.go);
    else this.host.show(null);
  }

  /** Stop what is being said, without touching the chip; whether there was anything. */
  halt(): boolean {
    const speaking = this.utterance !== null;
    this.host.captions.clear();
    this.utterance = null;
    this.lasting = null;
    if (speaking) void this.host.service.call("speak.stop").catch(() => {});
    return speaking;
  }
}
