/**
 * Talking to Dashi (docs/voice.md, "What the shell does"): the talk key held
 * is a listen, let go it is the words, which go to the launcher's agent
 * (`Asker`) and come back said in Dashi's voice with captions. Esc, or the
 * key again, stops Dashi at once. A tap listens to nothing: it stops Dashi
 * if it was speaking, and otherwise says how to talk. The Copilot key is the
 * one whose tap talks (many laptops can't hold it: keys.ts): the listen its
 * press opened goes on, and ends when the person stops talking or taps
 * again. An agent's question (`ask_person`) is said the same way, and the
 * next thing heard is its answer instead of an ask.
 *
 * The chip (chip.tsx) shows `getSnapshot()`; nothing here draws.
 */

import { maybe } from "@dashi/shape";
import { realTimers, type Timers } from "../shared/time/index.ts";
import { heldKeys, STOP, TALK_TAP, TAP_MS, type TalkKey, talks } from "./keys.ts";
import { head, listenLanguage, tail } from "./lib/captions.ts";
import { Saying } from "./lib/saying.ts";
import type { VoiceService } from "./lib/service.ts";
import { Captions, LevelStore } from "./lib/speech.ts";
import { TapListen } from "./lib/tap-listen.ts";
import { HeardReply, type VoiceEvent } from "./lib/wire.ts";
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
  private holding: { since: number; stopped: boolean; opened: Promise<boolean> | null; tap: boolean } | null = null;
  /** A listen a tap of the Copilot key began, which ends by itself (lib/tap-listen.ts). */
  private readonly tapped: TapListen;
  private asking: AbortController | null = null;
  /** What is being said, and a failed ask's words that outlast it (lib/saying.ts). */
  private readonly saying: Saying;
  private noticeTimer: unknown = null;
  private question: ((text: string) => void) | null = null;
  private held = "";
  private readonly off: () => void;

  constructor(private readonly deps: VoiceDeps) {
    this.timers = deps.timers ?? realTimers;
    this.captions = new Captions(this.timers, (chip) => this.show(chip));
    this.tapped = new TapListen(deps.service, this.timers);
    this.saying = new Saying({
      service: deps.service,
      captions: this.captions,
      voice: () => deps.prefs().voice,
      turn: () => this.turn,
      show: (chip) => this.show(chip),
      notice: (text, go, ms) => this.notice(text, go, ms),
      sync: () => this.sync(),
    });
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
    const busy = this.saying.busy || this.asking !== null || this.chip?.kind === "listening" || this.chip?.kind === "thinking";
    const keys = heldKeys(on ? key : null, busy);
    const text = JSON.stringify(keys);
    if (text === this.held) return;
    this.held = text;
    this.deps.hold(keys);
  }

  /** A `held-key` event of the compositor's. */
  key(name: string, down: boolean): void {
    if (name === STOP && down) this.stop();
    if (talks(name)) void (down ? this.keyDown(name === TALK_TAP) : this.keyUp());
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private keyDown(tap: boolean): void {
    if (this.holding) return;
    // The tap after the one that began a listen ends it, as letting go of a held key does.
    if (this.tapped.end()) return void this.words(this.turn);
    // Holding the key again stops Dashi at once, whatever else the press comes to.
    const stopped = this.halt();
    const turn = this.turn;
    const trouble = this.deps.trouble();
    this.holding = { since: this.now(), stopped, opened: null, tap };
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
    // The speaking model loads while the person talks, so the answer never waits for it (docs/voice.md, "Keep it warm").
    if (this.question === null) void this.deps.service.call("warm", { speak: true }).catch(() => {});
  }

  private async keyUp(): Promise<void> {
    const held = this.holding;
    this.holding = null;
    if (!held?.opened) return;
    const turn = this.turn;
    const short = this.now() - held.since < TAP_MS;
    if (!(await held.opened) || turn !== this.turn) return;
    if (short) {
      // The Copilot key's tap talks, unless it was the tap that stopped Dashi.
      if (held.tap && !held.stopped) return this.tap(turn);
      await this.deps.service.call("listen.cancel").catch(() => {});
      if (turn !== this.turn) return;
      if (held.stopped) this.show(null);
      else this.notice(`Hold ${this.deps.prefs().key.hold} to talk.`, undefined, 2500);
      return;
    }
    await this.words(turn);
  }

  /** A tap of the Copilot key: the listen goes on, and ends by itself once the person has talked and gone quiet. */
  private async tap(turn: number): Promise<void> {
    const nothing = (): void => {
      if (this.chip?.kind === "listening" && this.chip.text !== "") return;
      this.stop();
      this.notice("I didn't hear anything.", undefined, 2500);
    };
    await this.tapped.begin(() => turn === this.turn, nothing).catch((error) => turn === this.turn && this.notice(message(error), "voice"));
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
    if (answer.failed) this.saying.keep({ kind: "notice", text: head(answer.say, 90), ...(answer.failed.go ? { go: answer.failed.go } : {}) });
    await this.say(answer.say);
  }

  /** Say `text` in Dashi's voice (or `voice`), with captions. What can't be said is shown instead. */
  say(text: string, voice?: string): Promise<void> {
    return this.saying.say(text, voice);
  }

  private event(event: VoiceEvent): void {
    switch (event.event) {
      case "level":
        return this.level.set(event.level);
      case "partial":
        if (this.chip?.kind === "listening") this.show({ ...this.chip, text: event.text });
        return;
      case "heard":
        // A listen a tap began ended by itself: these are its words. (A held key's come in `listen.stop`'s reply.)
        if (!this.tapped.end()) return;
        if (event.text.trim() === "") return this.notice("I didn't hear anything.", undefined, 2500);
        return void this.heard(event.text.trim(), this.turn);
      case "sentence":
        return this.saying.sentence(event.id, event.text, event.words);
      case "spoken":
        return this.saying.spoken(event.id);
      case "error":
        if (this.chip?.kind === "listening" || this.chip?.kind === "thinking") this.notice(event.message, "voice");
        return;
      default:
        return;
    }
  }

  /** Stop what is under way without touching the chip; whether there was anything. */
  private halt(): boolean {
    this.turn++;
    this.tapped.end();
    const asking = this.asking !== null;
    this.asking?.abort();
    this.asking = null;
    return this.saying.halt() || asking;
  }

  /** Esc, or a press on the chip: Dashi stops speaking, thinking or listening, at once. */
  stop(): void {
    const open = this.tapped.running || this.chip?.kind === "thinking";
    const listening = this.holding?.opened ?? (open ? Promise.resolve(true) : null);
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
      if (spoken && this.saying.busy) this.stop();
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
