/**
 * Talking to Dashi (docs/voice.md, "What the shell does"): the talk key held is a listen, let go it is the words, which go to
 * Dashi's assistant (`Asker`) and come back said in Dashi's voice as they are written, with captions. ❖Esc, or the key again,
 * stops Dashi at once. A tap listens to nothing: it stops Dashi if it was speaking, and otherwise says how to talk; the Copilot
 * key is the one whose tap talks (keys.ts). An agent's question (`ask_person`) is said the same way, and the next thing heard
 * is its answer instead of an ask. While the conversation is open (`Asker.talk`), the microphone opens by itself once Dashi's
 * last sentence has played, for the reply; after a question it always does (lib/mic.ts).
 *
 * The chip (chip.tsx) shows `getSnapshot()`; nothing here draws.
 */

import { maybe } from "@dashi/shape";
import { realTimers, type Timers } from "../shared/time/index.ts";
import { heldKeys, STOP, TALK_TAP, TAP_MS, talks } from "./keys.ts";
import { Asking } from "./lib/asking.ts";
import { tail } from "./lib/captions.ts";
import { ChipStore } from "./lib/chip-store.ts";
import { Mic } from "./lib/mic.ts";
import { type RunEnd, Saying } from "./lib/saying.ts";
import { Captions, LevelStore } from "./lib/speech.ts";
import { HeardReply, type VoiceEvent } from "./lib/wire.ts";
import type { Chip, ChipGo, VoiceDeps } from "./types.ts";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class Voice {
  readonly level = new LevelStore();
  /** What the chip shows (lib/chip-store.ts). */
  private readonly chips: ChipStore;
  private readonly timers: Timers;
  private readonly captions: Captions;
  /** Bumped by every press and stop: what an older press was waiting for is no longer wanted. */
  private turn = 0;
  private holding: { since: number; stopped: boolean; opened: Promise<boolean> | null; tap: boolean; sure: boolean } | null = null;
  /** The microphone: a key's listen, and the ones that end by themselves (lib/mic.ts). */
  private readonly mic: Mic;
  /** The ask being answered (lib/asking.ts), and what is being said (lib/saying.ts). */
  private readonly asking: Asking;
  private readonly saying: Saying;
  private question: ((text: string) => void) | null = null;
  private held = "";
  private readonly offs: Array<() => void> = [];

  constructor(private readonly deps: VoiceDeps) {
    this.timers = deps.timers ?? realTimers;
    this.chips = new ChipStore(this.timers, deps.asker.talk, () => this.sync());
    this.captions = new Captions(this.timers, (chip) => this.show(chip));
    this.mic = new Mic({
      service: deps.service,
      timers: this.timers,
      locale: deps.locale,
      turn: () => this.turn,
      chip: () => this.chip,
      listening: () => this.listening(),
      notice: (text, go, ms) => this.notice(text, go, ms),
      rest: () => this.rest(true),
      mayOpen: () => !this.holding && !this.saying.busy && !this.deps.trouble() && this.deps.prefs().on,
    });
    const { show } = this;
    this.saying = new Saying({
      service: deps.service,
      captions: this.captions,
      voice: () => deps.prefs().voice,
      show,
      notice: (text, go, ms) => this.notice(text, go, ms),
      sync: () => this.sync(),
      ended: (end) => this.said(end),
      lull: () => (this.question ? this.mic.again() : this.asking.lull()),
      log: deps.log,
    });
    this.asking = new Asking({ asker: deps.asker, saying: this.saying, captions: this.captions, show, rest: () => this.rest(true), log: deps.log });
    this.offs.push(deps.service.on((event) => this.event(event)));
    this.sync();
  }

  subscribe = (listener: () => void): (() => void) => this.chips.subscribe(listener);

  getSnapshot = (): Chip | null => this.chips.getSnapshot();

  private get chip(): Chip | null {
    return this.chips.getSnapshot();
  }
  private readonly show = (chip: Chip | null): void => this.chips.show(chip);
  private readonly rest = (quiet = false): void => this.chips.rest(quiet);
  private readonly notice = (text: string, go?: ChipGo, ms?: number): void => this.chips.notice(text, go, ms);
  private readonly now = (): number => this.deps.now?.() ?? Date.now();

  /** The keys held follow the settings and what there is to stop (the pane's switch, the key's choice). */
  sync(): void {
    const { on, key } = this.deps.prefs();
    const keys = heldKeys(on ? key : null);
    const text = JSON.stringify(keys);
    if (text === this.held) return;
    this.held = text;
    this.deps.hold(keys);
  }

  /** A `held-key` event of the compositor's. */
  key(name: string, down: boolean): void {
    if (name === STOP && down) this.stop(true);
    if (talks(name)) void (down ? this.keyDown(name === TALK_TAP) : this.keyUp());
  }

  /** The Dashi key (❖Space) became a hold: a listen, as a talk key held; `release` ends it with its words. */
  hold(): void {
    this.keyDown(false, true);
  }

  release(): void {
    void this.keyUp();
  }

  private keyDown(tap: boolean, sure = false): void {
    if (this.holding) return;
    // A listen that opened by itself and has heard nothing yet gives way to the key's own.
    const waiting = this.mic.waiting;
    // The tap after the one that began a listen ends it, as letting go of a held key does.
    if (!waiting && this.mic.end()) return void this.words(this.turn);
    // Holding the key again stops Dashi at once; an ask that waits for the answer to its question goes on.
    const stopped = this.question && this.asking.active ? this.quiet() : this.halt();
    const turn = this.turn;
    const trouble = this.deps.trouble();
    this.holding = { since: this.now(), stopped, opened: null, tap, sure };
    if (trouble) return this.notice(trouble.text, trouble.go);
    this.listening();
    this.holding.opened = waiting ? this.mic.cancel().then(() => this.mic.open(turn)) : this.mic.open(turn);
    // The speaking model loads while the person talks, so the answer never waits for it (docs/voice.md, "Keep it warm").
    if (this.question === null) void this.deps.service.call("warm", { speak: true }).catch(() => {});
  }

  /** The chip while the microphone is open. */
  private listening(): void {
    this.level.set(0);
    this.show({ kind: "listening", text: "", question: this.question !== null });
  }

  private async keyUp(): Promise<void> {
    const held = this.holding;
    this.holding = null;
    if (!held?.opened) return;
    const turn = this.turn;
    const short = !held.sure && this.now() - held.since < TAP_MS;
    if (!(await held.opened) || turn !== this.turn) return;
    if (short) {
      // The Copilot key's tap talks, unless it was the tap that stopped Dashi.
      if (held.tap && !held.stopped) return this.mic.tap(turn);
      await this.mic.cancel();
      if (turn !== this.turn) return;
      if (held.stopped) this.rest(true);
      else this.notice(`Hold ${this.deps.prefs().key.hold} to talk.`, undefined, 2500);
      return;
    }
    await this.words(turn);
  }

  /** What was being said ended: the conversation rests, and after a last sentence that played Dashi listens for the reply. */
  private said(end: RunEnd): void {
    if (end === "paused") return;
    const talk = this.deps.asker.talk;
    talk?.rested();
    if (end === "done" && (this.question || (talk?.open() && this.deps.prefs().listenAgain !== false))) this.mic.again();
    if (this.chip === null) this.rest();
  }

  /** The listen ends here: its words, then what they are for. */
  private async words(turn: number): Promise<void> {
    this.show({ kind: "thinking", text: this.chip?.kind === "listening" ? this.chip.text : "" });
    let text: string;
    try {
      text = maybe(HeardReply, await this.deps.service.call("listen.stop"))?.text.trim() ?? "";
    } catch (error) {
      if (turn === this.turn) this.notice(message(error), "voice");
      return;
    }
    if (turn !== this.turn) return;
    if (text === "") return this.notice("I didn't hear anything.", undefined, 2500);
    this.heard(text);
  }

  /** The words are here: an agent's question gets them, else Dashi's assistant is asked. */
  private heard(text: string): void {
    this.deps.asker.talk?.busy();
    const question = this.question;
    if (question) {
      this.question = null;
      this.notice(`You said: ${tail(text, 80)}`, undefined, 2500);
      return question(text);
    }
    void this.asking.ask(text);
  }

  say(text: string, voice?: string): void {
    this.saying.say(text, voice);
  }

  private event(event: VoiceEvent): void {
    switch (event.event) {
      case "level":
        return this.level.set(event.level);
      case "partial":
        if (this.chip?.kind === "listening") this.show({ ...this.chip, text: event.text });
        return;
      case "heard":
        // A listen that ends by itself ended: these are its words. (A held key's come in `listen.stop`'s reply.)
        if (!this.mic.end()) return;
        if (event.text.trim() === "")
          return this.question || this.deps.asker.talk?.open() ? this.rest(true) : this.notice("I didn't hear anything.", undefined, 2500);
        return this.heard(event.text.trim());
      case "sentence":
        return this.saying.sentence(event.id, event.text, event.words);
      case "spoken":
        return this.saying.spoken(event.id, event.reason);
      case "error":
        if (this.chip?.kind === "listening" || this.chip?.kind === "thinking") this.notice(event.message, "voice");
        return;
      default:
        return;
    }
  }

  /** No listen that ends by itself goes on, or opens: what an older press waited for is no longer wanted. */
  private unlisten(): void {
    this.turn++;
    this.mic.end();
  }

  /** Stop the sound, not the ask under way; whether Dashi was speaking. */
  private quiet(): boolean {
    this.unlisten();
    return this.saying.halt();
  }

  /** Stop what is under way without touching the chip; whether there was anything. */
  private halt(): boolean {
    const speaking = this.quiet();
    return this.asking.abort() || speaking;
  }

  /** A press on the chip or the capsule's square: Dashi stops speaking, thinking or listening, at once. `all` (❖Esc) ends the conversation too. */
  stop(all = false): void {
    const open = this.mic.running || this.chip?.kind === "thinking";
    const listening = this.holding?.opened ?? (open ? Promise.resolve(true) : null);
    this.holding = null;
    this.halt();
    if (listening) void listening.then((opened) => opened && this.mic.cancel());
    if (all) this.deps.asker.talk?.end("stopped");
    this.rest(true);
  }

  /**
   * An agent's question (`ask_person`): said out loud after whatever Dashi is saying, and the next words heard are its answer
   * (the microphone opens for them by itself). Returns what ends it: `keep` lets what is being said finish (a card answered by a press).
   */
  ask(words: string, heard: (text: string) => void): (keep?: boolean) => void {
    this.question = heard;
    const spoken = this.deps.trouble() === null && this.deps.prefs().on;
    if (spoken && this.saying.busy) this.saying.add(words);
    else if (spoken) this.saying.say(words, undefined, "(a question)");
    return (keep = false) => {
      if (this.question !== heard) return;
      this.question = null;
      // The microphone that opened for its answer closes: what is said next would be taken for a new ask.
      if (this.mic.selfEnding) {
        this.unlisten();
        void this.mic.cancel();
        if (this.asking.active) this.asking.lull();
        else this.rest();
      }
      if (keep || !spoken || this.asking.active) return;
      if (this.saying.busy) this.stop();
    };
  }

  /** A dictation opens the microphone: what Dashi was saying waits for it, and is said after (`resumeSpeech`). */
  pauseSpeech(): void {
    if (!this.saying.busy && !this.asking.active) return;
    this.unlisten();
    this.saying.pause();
    this.show({ kind: "notice", text: "Paused while you dictate." });
  }

  resumeSpeech(): void {
    if (!this.saying.holding || this.saying.resume(this.asking.active)) return;
    if (this.asking.active) this.asking.lull();
    else this.rest(true);
  }

  /** How the person answers by voice now ("the right ❖ key"), or null when they can't. */
  talkKey(): string | null {
    const { on, key } = this.deps.prefs();
    return on && this.deps.trouble() === null ? key.hold : null;
  }

  close(): void {
    for (const off of this.offs) off();
    this.halt();
    this.captions.clear();
    this.chips.close();
  }
}
