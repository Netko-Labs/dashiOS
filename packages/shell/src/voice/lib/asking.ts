/**
 * One spoken ask, from the words to the end of the answer: the assistant is
 * asked, what it says is spoken as it comes (each sentence as soon as it is
 * whole), and each thing it does is the chip's line. voice.ts hears the
 * words and decides what happens after; this carries one ask.
 */

import type { Answer, Asker, Chip } from "../types.ts";
import { head } from "./captions.ts";
import type { Saying } from "./saying.ts";
import type { Captions } from "./speech.ts";

export interface AskingHost {
  asker: Asker;
  saying: Saying;
  captions: Captions;
  show(chip: Chip | null): void;
  /** Nothing was said back: the chip goes to rest. */
  rest(): void;
  /** One line for the shell's log. */
  log?: ((line: string) => void) | undefined;
}

const FAILED: Answer = { say: "Something went wrong, and I couldn't ask.", failed: {} };

export class Asking {
  private controller: AbortController | null = null;
  /** What Dashi is doing now, in its words; "" between steps. */
  private step = "";
  private words = "";

  /** A question that just went unanswered: until then, words that only answer it are not a new ask. */
  private over: { until: number; answers(text: string): boolean } | null = null;

  constructor(private readonly host: AskingHost) {}

  late(over: { until: number; answers(text: string): boolean }): void {
    this.over = over;
  }

  /** Whether `words` only answer a question that is over: said a moment too late, they ask nothing. */
  tooLate(words: string, now: number): boolean {
    const over = this.over;
    this.over = null;
    return over !== null && now < over.until && over.answers(words);
  }

  /** Dashi's last answer ended in a question: a bare "Okay" heard next answers it. */
  asked = false;

  /** An ask is being answered. */
  get active(): boolean {
    return this.controller !== null;
  }

  /** Give the ask up: nothing more of it is said or shown. Whether there was one. */
  abort(): boolean {
    const controller = this.controller;
    this.controller = null;
    this.step = "";
    controller?.abort();
    return controller !== null;
  }

  /** The chip while the assistant works and nothing is being said: its step, or that it thinks. */
  lull(): void {
    if (!this.controller) return;
    this.host.show(this.step ? { kind: "working", text: this.step } : { kind: "thinking", text: this.words });
  }

  /** More words for what is being said, or for after the dictation that holds it. */
  private say(asked: string, text: string): void {
    const { saying } = this.host;
    if (saying.holding) return saying.hold(text);
    if (!saying.busy) saying.begin(asked);
    saying.add(text);
  }

  async ask(words: string, language?: string): Promise<void> {
    const { host } = this;
    this.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.words = words;
    const live = (): boolean => this.controller === controller && !controller.signal.aborted;
    host.show({ kind: "thinking", text: words });
    const answer = await host.asker
      .ask(words, controller.signal, {
        language,
        say: (text) => live() && this.say(words, text),
        step: (title) => {
          if (!live()) return;
          this.step = title;
          // The step takes the line; what is being said goes on being heard.
          host.captions.clear();
          host.show({ kind: "working", text: title });
        },
      })
      .catch((error): Answer => {
        host.log?.(`ask failed: ${error instanceof Error ? error.message : String(error)}`);
        return FAILED;
      });
    if (!live()) return;
    this.controller = null;
    this.step = "";
    this.asked = answer.say.trim().endsWith("?");
    if (answer.failed) host.saying.keep({ kind: "notice", text: head(answer.say, 90), ...(answer.failed.go ? { go: answer.failed.go } : {}) });
    if (answer.say.trim() !== "") this.say(words, `\n\n${answer.say}\n\n`);
    // A stopped ask, or one that only did things, says nothing more.
    if (host.saying.busy) host.saying.close();
    else if (!host.saying.holding) host.rest();
  }
}
