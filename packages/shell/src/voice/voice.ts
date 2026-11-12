/**
 * Talking to Dashi (docs/voice.md, "What the shell does"): the talk key held
 * is a listen, let go it is the words, which go to the launcher's agent
 * (`Asker`) and come back said in Dashi's voice with captions. Esc, or the
 * key again, stops Dashi at once. A tap listens to nothing: it stops Dashi
 * if it was speaking, and otherwise says how to talk. An agent's question
 * (`ask_person`) is said the same way, and the next thing heard is its
 * answer instead of an ask.
 *
 * The chip (chip.tsx) shows `getSnapshot()`; nothing here draws.
 */

import { maybe } from "@dashi/shape";
import { realTimers, type Timers } from "../shared/time/index.ts";
import { heldKeys, STOP, TALK, TAP_MS, type TalkKey } from "./keys.ts";
import { head, listenLanguage, tail } from "./lib/captions.ts";
import type { VoiceService } from "./lib/service.ts";
import { Captions, LevelStore } from "./lib/speech.ts";
import { HeardReply, SpeakReply, type VoiceEvent } from "./lib/wire.ts";
import type { Answer, Asker, Chip, ChipGo, Trouble } from "./types.ts";

/** How long a notice stays. */
export const NOTICE_MS = 4000;
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface VoiceDeps {
  service: VoiceService;
  /** Voice is on (settings.json), and its key and voice. */
  prefs(): { on: boolean; key: TalkKey; voice: string | undefined };
  /** What stops Voice from being used now (models.ts, the service), or null. */
  trouble(): Trouble;
  /** The keys the compositor holds for the shell (`held-keys`). */
  hold(keys: ReturnType<typeof heldKeys>): void;
  asker: Asker;
  /** The session's locale, for a language only Whisper hears. */
  locale?: string | undefined;
  timers?: Timers;
  now?(): number;
}

export class Voice {
  readonly level = new LevelStore();
  private chip: Chip | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly timers: Timers;
  private readonly captions: Captions;
  /** Bumped by every press and stop: what an older press was waiting for is no longer wanted. */
  private turn = 0;
  private holding: { since: number; stopped: boolean; opened: Promise<boolean> | null } | null = null;
  private asking: AbortController | null = null;
  /** The utterance being said (`speak`'s id); `pending` from the ask until the service names it. */
  private utterance: number | "pending" | null = null;
  /** A notice that outlasts the speech said with it (a failed ask). */
  private lasting: Chip | null = null;
  private noticeTimer: unknown = null;
  private question: ((text: string) => void) | null = null;
  private held = "";
  private readonly off: () => void;

  constructor(private readonly deps: VoiceDeps) {
    this.timers = deps.timers ?? realTimers;
    this.captions = new Captions(this.timers, (chip) => this.show(chip));
    this.off = deps.service.on((event) => this.event(event));
    this.sync();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Chip | null => this.chip;

  private show(chip: Chip | null): void {
    if (this.noticeTimer !== null) this.timers.clear(this.noticeTimer);
    this.noticeTimer = null;
    this.chip = chip;
    for (const listener of [...this.listeners]) listener();
    this.sync();
  }

  /** Words where the person is looking, for a while. */
  private notice(text: string, go?: ChipGo, ms = NOTICE_MS): void {
    this.show({ kind: "notice", text: head(text, 90), ...(go ? { go } : {}) });
    this.noticeTimer = this.timers.set(() => this.show(null), ms);
  }

  /** The keys held follow the settings and what there is to stop (the pane's switch, the key's choice). */
  sync(): void {
    const { on, key } = this.deps.prefs();
    const busy = this.utterance !== null || this.asking !== null || this.chip?.kind === "listening" || this.chip?.kind === "thinking";
    const keys = heldKeys(on ? key : null, busy);
    const text = JSON.stringify(keys);
    if (text === this.held) return;
    this.held = text;
    this.deps.hold(keys);
  }

  /** A `held-key` event of the compositor's. */
  key(name: string, down: boolean): void {
    if (name === STOP && down) this.stop();
    if (name === TALK) void (down ? this.keyDown() : this.keyUp());
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private keyDown(): void {
    if (this.holding) return;
    // Holding the key again stops Dashi at once, whatever else the press comes to.
    const stopped = this.halt();
    const turn = this.turn;
    const trouble = this.deps.trouble();
    this.holding = { since: this.now(), stopped, opened: null };
    if (trouble) return this.notice(trouble.text, trouble.go);
    this.level.set(0);
    this.show({ kind: "listening", text: "", question: this.question !== null });
    const language = listenLanguage(this.deps.locale);
    this.holding.opened = this.deps.service.call("listen", language ? { language } : {}).then(
      () => true,
      (error) => {
        if (turn === this.turn) this.notice(message(error), "voice");
        return false;
      },
    );
  }

  private async keyUp(): Promise<void> {
    const held = this.holding;
    this.holding = null;
    if (!held?.opened) return;
    const turn = this.turn;
    const short = this.now() - held.since < TAP_MS;
    if (!(await held.opened) || turn !== this.turn) return;
    if (short) {
      await this.deps.service.call("listen.cancel").catch(() => {});
      if (turn !== this.turn) return;
      if (held.stopped) this.show(null);
      else this.notice(`Hold ${this.deps.prefs().key.hold} to talk.`, undefined, 2500);
      return;
    }
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
    await this.heard(text, turn);
  }

  /** The words are here: an agent's question gets them, else the launcher's agent is asked. */
  private async heard(text: string, turn: number): Promise<void> {
    const question = this.question;
    if (question) {
      this.question = null;
      this.notice(`You said: ${tail(text, 80)}`, undefined, 2500);
      return question(text);
    }
    this.show({ kind: "thinking", text });
    const asking = new AbortController();
    this.asking = asking;
    const answer = await this.deps.asker.ask(text, asking.signal).catch((): Answer => ({ say: "Something went wrong, and I couldn't ask.", failed: {} }));
    if (turn !== this.turn || asking.signal.aborted) return;
    this.asking = null;
    // A stopped ask says nothing.
    if (answer.say.trim() === "") return this.show(null);
    if (answer.failed) this.lasting = { kind: "notice", text: head(answer.say, 90), ...(answer.failed.go ? { go: answer.failed.go } : {}) };
    await this.say(answer.say);
  }

  /** Say `text` in Dashi's voice (or `voice`), with captions. What can't be said is shown instead. */
  async say(text: string, voice?: string): Promise<void> {
    const turn = this.turn;
    const chosen = voice ?? this.deps.prefs().voice;
    this.utterance = "pending";
    if (this.lasting) this.show(this.lasting);
    else this.sync();
    try {
      const reply = maybe(SpeakReply, await this.deps.service.call("speak", { text, ...(chosen ? { voice: chosen } : {}) }));
      if (turn === this.turn && this.utterance === "pending") this.utterance = reply?.id ?? null;
    } catch {
      if (turn !== this.turn) return;
      this.utterance = null;
      const lasting = this.lasting;
      this.lasting = null;
      this.notice(lasting?.kind === "notice" ? lasting.text : text, lasting?.kind === "notice" ? lasting.go : undefined, 8000);
    }
  }

  private event(event: VoiceEvent): void {
    switch (event.event) {
      case "level":
        return this.level.set(event.level);
      case "partial":
        if (this.chip?.kind === "listening") this.show({ ...this.chip, text: event.text });
        return;
      case "sentence":
        // A failed ask's words stay in the chip while they are said.
        if (event.id === this.utterance && !this.lasting) this.captions.sentence(event.text, event.words);
        return;
      case "spoken":
        if (event.id === this.utterance) this.ended();
        return;
      case "error":
        if (this.chip?.kind === "listening" || this.chip?.kind === "thinking") this.notice(event.message, "voice");
        return;
      default:
        return;
    }
  }

  /** The utterance ended by itself: the chip goes, or a failed ask's words stay a while longer. */
  private ended(): void {
    this.captions.clear();
    this.utterance = null;
    const lasting = this.lasting;
    this.lasting = null;
    if (lasting?.kind === "notice") this.notice(lasting.text, lasting.go);
    else this.show(null);
  }

  /** Stop what is under way without touching the chip; whether there was anything. */
  private halt(): boolean {
    this.turn++;
    const speaking = this.utterance !== null;
    const asking = this.asking !== null;
    this.asking?.abort();
    this.asking = null;
    this.captions.clear();
    this.utterance = null;
    this.lasting = null;
    if (speaking) void this.deps.service.call("speak.stop").catch(() => {});
    return speaking || asking;
  }

  /** Esc, or a press on the chip: Dashi stops speaking, thinking or listening, at once. */
  stop(): void {
    const listening = this.holding?.opened ?? (this.chip?.kind === "thinking" ? Promise.resolve(true) : null);
    this.holding = null;
    this.halt();
    if (listening) void listening.then((opened) => opened && this.deps.service.call("listen.cancel").catch(() => {}));
    this.show(null);
  }

  /**
   * An agent's question (`ask_person`): said out loud when Voice can speak, and
   * the next words heard are its answer. Returns what ends it (answered another
   * way, given up on): the question is forgotten and its speech stopped.
   */
  ask(words: string, heard: (text: string) => void): () => void {
    this.question = heard;
    const spoken = this.deps.trouble() === null && this.deps.prefs().on;
    if (spoken) {
      this.halt();
      void this.say(words);
    }
    return () => {
      if (this.question !== heard) return;
      this.question = null;
      if (spoken && this.utterance !== null) this.stop();
    };
  }

  /** How the person answers by voice now ("the right ❖ key"), or null when they can't. */
  talkKey(): string | null {
    const { on, key } = this.deps.prefs();
    return on && this.deps.trouble() === null ? key.hold : null;
  }

  close(): void {
    this.off();
    this.halt();
    this.captions.clear();
    if (this.noticeTimer !== null) this.timers.clear(this.noticeTimer);
  }
}
