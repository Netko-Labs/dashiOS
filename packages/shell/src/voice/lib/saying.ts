/**
 * What Dashi says: a run of speech (the answer to one ask, a question, a
 * sample), a sentence at a time. Each sentence is one `speak`, queued after
 * the one before, so words can be added while the first are heard and
 * nothing is ever cut: a run ends when its last sentence has played, when
 * it is stopped, or when the service fails. A dictation that starts while
 * Dashi speaks pauses the run: what was not said is kept and said after.
 *
 * One line a run goes to the shell's log: what was asked, how many
 * sentences were handed to `speak`, how many the service says it played,
 * and why it ended. voice.ts decides when; this keeps what is being said.
 */

import { maybe } from "@dashi/shape";
import type { Chip, ChipGo } from "../types.ts";
import { sentencesOf } from "./sentences.ts";
import type { VoiceService } from "./service.ts";
import type { Captions } from "./speech.ts";
import { SpeakReply, type SpokenWord } from "./wire.ts";

type Notice = Extract<Chip, { kind: "notice" }>;
export type RunEnd = "done" | "stopped" | "failed" | "paused";

/** What saying needs of the voice it is part of. */
export interface SayingHost {
  service: VoiceService;
  captions: Captions;
  /** Dashi's voice as chosen in Settings; its own when none. */
  voice(): string | undefined;
  show(chip: Chip | null): void;
  notice(text: string, go?: ChipGo, ms?: number): void;
  /** The keys held follow what there is to stop. */
  sync(): void;
  /** A run ended: every sentence played (`done`), or why not. */
  ended?(end: RunEnd): void;
  /** Every sentence handed so far has played, and more may come: the chip is whoever's is working. */
  lull?(): void;
  /** One line for the shell's log. */
  log?: ((line: string) => void) | undefined;
}

interface Sentence {
  text: string;
  /** `speak`'s id, once the service has named it. */
  id: number | null;
}

interface Run {
  asked: string;
  voice: string | undefined;
  /** Handed to `speak` and not ended yet, in order. */
  waiting: Sentence[];
  handed: number;
  played: number;
  /** No more words will be added. */
  closed: boolean;
  /** One after another, so the service hears them in order. */
  sending: Promise<void>;
}

const quoted = (text: string): string => JSON.stringify(text.length > 80 ? `${text.slice(0, 79)}…` : text);

export class Saying {
  private run: Run | null = null;
  /** A notice that outlasts the speech said with it. */
  private lasting: Notice | null = null;
  /** What a dictation interrupted: said again from the sentence it stopped in. */
  private paused: { asked: string; voice: string | undefined; rest: string[] } | null = null;
  /** `sentence` and `spoken` events that came before `speak` answered with their id. */
  private early: Array<{ id: number; apply(): void }> = [];

  constructor(private readonly host: SayingHost) {}

  /** Something is being said, or about to be. */
  get busy(): boolean {
    return this.run !== null;
  }

  /** A dictation holds the rest of what Dashi was saying. */
  get holding(): boolean {
    return this.paused !== null;
  }

  /** These words stay in the chip while the next thing is said, and a while after. */
  keep(notice: Notice): void {
    this.lasting = notice;
  }

  /** Say `text` whole in Dashi's voice (or `voice`), with captions. What can't be said is shown instead. */
  say(text: string, voice?: string, asked = ""): void {
    this.begin(asked, voice);
    this.add(text);
    this.close();
  }

  /** A run of speech begins; whatever was being said stops. */
  begin(asked: string, voice?: string): void {
    // What was queued for the run before would otherwise still be said.
    if (this.end("stopped")) void this.host.service.call("speak.stop").catch(() => {});
    this.paused = null;
    this.run = { asked, voice: voice ?? this.host.voice(), waiting: [], handed: 0, played: 0, closed: false, sending: Promise.resolve() };
    if (this.lasting) this.host.show(this.lasting);
    else this.host.sync();
  }

  /** More words for the run under way: each sentence goes to `speak` now, after the ones before. */
  add(text: string): void {
    const run = this.run;
    if (!run) return;
    for (const words of sentencesOf(text)) {
      const sentence: Sentence = { text: words, id: null };
      run.waiting.push(sentence);
      run.handed++;
      run.sending = run.sending.then(() => this.hand(run, sentence));
    }
  }

  /** No more words will be added: the run ends when the last of them has played. */
  close(): void {
    const run = this.run;
    if (!run) return;
    run.closed = true;
    void run.sending.then(() => this.settle(run));
  }

  private async hand(run: Run, sentence: Sentence): Promise<void> {
    if (this.run !== run) return;
    try {
      // Queued, always: a `speak` without it would stop the sentence before.
      const reply = maybe(SpeakReply, await this.host.service.call("speak", { text: sentence.text, queue: true, ...(run.voice ? { voice: run.voice } : {}) }));
      if (this.run !== run) return;
      sentence.id = reply?.id ?? null;
      if (sentence.id === null) return this.fail(run, sentence);
      const early = this.early.filter((event) => event.id === sentence.id);
      this.early = this.early.filter((event) => event.id !== sentence.id);
      for (const event of early) event.apply();
    } catch {
      if (this.run === run) this.fail(run, sentence);
    }
  }

  /** The service would not say it: the words are shown instead, and the run ends. */
  private fail(run: Run, sentence: Sentence): void {
    const text = [sentence.text, ...run.waiting.slice(run.waiting.indexOf(sentence) + 1).map((each) => each.text)].join(" ");
    const lasting = this.lasting;
    this.end("failed");
    void this.host.service.call("speak.stop").catch(() => {});
    this.host.notice(lasting?.text ?? text, lasting?.go, 8000);
    this.host.ended?.("failed");
  }

  private owns(id: number): Sentence | undefined {
    return this.run?.waiting.find((sentence) => sentence.id === id);
  }

  /** An event for a sentence whose `speak` has not answered yet waits for it. */
  private later(id: number, apply: () => void): boolean {
    if (!this.run?.waiting.some((sentence) => sentence.id === null)) return false;
    this.early.push({ id, apply });
    return true;
  }

  /** A sentence's first sound plays now: its caption, unless a failed ask's words hold the chip. */
  sentence(id: number, text: string, words: readonly SpokenWord[]): void {
    if (!this.owns(id)) return void this.later(id, () => this.sentence(id, text, words));
    if (!this.lasting) this.host.captions.sentence(text, words);
  }

  /** A sentence ended: played to its end, or not. */
  spoken(id: number, reason: "done" | "stopped" | "failed" = "done"): void {
    const run = this.run;
    const sentence = this.owns(id);
    if (!run || !sentence) return void this.later(id, () => this.spoken(id, reason));
    if (reason !== "done") return reason === "failed" ? this.fail(run, sentence) : this.finish("stopped");
    run.waiting = run.waiting.filter((each) => each !== sentence);
    run.played++;
    this.settle(run);
  }

  /** The run is over once it is closed and nothing waits; open with nothing waiting, it is a lull. */
  private settle(run: Run): void {
    if (this.run !== run || run.waiting.length > 0) return;
    if (run.closed) return this.finish("done");
    this.host.captions.clear();
    this.host.lull?.();
  }

  /** The run ended by itself, or the service stopped it: the chip goes, or a failed ask's words stay a while longer. */
  private finish(end: RunEnd): void {
    const lasting = this.lasting;
    this.end(end);
    if (lasting) this.host.notice(lasting.text, lasting.go);
    else this.host.show(null);
    this.host.ended?.(end);
  }

  /** The run is over: its line in the log. Nothing is shown here. */
  private end(end: RunEnd): Run | null {
    const run = this.run;
    if (!run) return null;
    this.run = null;
    this.early = [];
    this.lasting = null;
    this.host.captions.clear();
    this.host.log?.(`said asked=${quoted(run.asked)} handed=${run.handed} played=${run.played} ended=${end}`);
    return run;
  }

  /** Stop what is being said, without touching the chip; whether there was anything. */
  halt(): boolean {
    const speaking = this.end("stopped") !== null;
    this.paused = null;
    if (speaking) void this.host.service.call("speak.stop").catch(() => {});
    return speaking;
  }

  /**
   * A dictation opens the microphone, which stops the sound (the service's
   * rule): the sentences not yet played to their end are kept for `resume`,
   * and so is what `hold` adds meanwhile. Whether anything was being said.
   */
  pause(): boolean {
    const run = this.end("paused");
    this.paused = { asked: run?.asked ?? "", voice: run?.voice ?? this.host.voice(), rest: run?.waiting.map((sentence) => sentence.text) ?? [] };
    if (!run) return false;
    void this.host.service.call("speak.stop").catch(() => {});
    this.host.ended?.("paused");
    return true;
  }

  /** Words that came while a dictation holds the speech: said after it. */
  hold(text: string): void {
    this.paused?.rest.push(...sentencesOf(text));
  }

  /** The dictation is over: what it interrupted is said from where it stopped. `more` when words may still be added. */
  resume(more = false): boolean {
    const paused = this.paused;
    this.paused = null;
    if (!paused || this.run || paused.rest.length === 0) return false;
    this.begin(paused.asked, paused.voice);
    for (const sentence of paused.rest) this.add(sentence);
    if (!more) this.close();
    return true;
  }
}
