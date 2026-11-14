/**
 * Dictation (docs/voice.md, "Dictation"; docs/night-0.9-contract.md, "core"):
 * the dictation key held alone opens the microphone, let go it is the words,
 * tidied by rule and typed into the field that has the keyboard. A double
 * tap is hands-free (lib/hands-free.ts). One `DictationState` at a time is
 * told on the hub, where the capsule draws it; nothing here draws.
 *
 * What it keeps: a password field never opens the microphone; "listening" is
 * said only once the microphone is open, so words said before are not
 * claimed; a key that turns out a modifier (`chord`) heard nothing.
 */

import { maybe } from "@dashi/shape";
import { DICTATION_LIMITS, type DictationCommand, type DictationState, type DictationTrouble, type KeyGesture } from "../shared/pill/index.ts";
import { realTimers, type Timers } from "../shared/time/index.ts";
import { HandsFree } from "./lib/hands-free.ts";
import { HeardText } from "./lib/heard.ts";
import { land } from "./lib/land.ts";
import { HINT, troubleLine, troubleOf } from "./lib/lines.ts";
import type { DictationDeps, Front, HearingEvent } from "./types.ts";

export class Dictation {
  private readonly timers: Timers;
  /** Bumped by every press and stop: what an older press waited for is no longer wanted. */
  private turn = 0;
  /** A hold: whether its listen opened (null until it was asked), and the window the key went down in. */
  private hold: { opened: Promise<boolean> | null; at: Promise<Front | null> } | null = null;
  private at: Promise<Front | null> = Promise.resolve(null);
  private readonly handsFree: HandsFree;
  private timer: unknown = null;
  private limits: unknown[] = [];
  private readonly offs: Array<() => void>;

  constructor(private readonly deps: DictationDeps) {
    this.timers = deps.timers ?? realTimers;
    this.handsFree = new HandsFree(
      { ...deps, timers: this.timers },
      {
        show: (state) => this.show(state),
        notice: (trouble, handsFree) => this.notice(trouble, undefined, handsFree),
        ready: (at) => this.ready(at),
        phase: () => this.state.phase,
      },
    );
    this.offs = [deps.service.on((event) => this.event(event)), deps.hub.dictationCommands.handle((command) => this.command(command))];
  }

  private get state(): DictationState {
    return this.deps.hub.dictation.getSnapshot();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** One state at a time; one that ends by itself (`until`) goes back to idle then. */
  private show(state: DictationState): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    if (state.phase !== "listening") this.deps.hub.level.set(0);
    this.deps.hub.dictation.set(state);
    if ("until" in state) this.timer = this.timers.set(() => this.show({ phase: "idle" }), Math.max(0, state.until - this.now()));
  }

  private notice(trouble: DictationTrouble, line?: string, handsFree = false): void {
    const words = line ?? troubleLine(trouble, this.deps.prefs().name, handsFree);
    this.show({ phase: "notice", trouble, line: words, until: this.now() + DICTATION_LIMITS.notice });
  }

  private clearLimits(): void {
    for (const limit of this.limits) this.timers.clear(limit);
    this.limits = [];
  }

  /** The dictation key did something (lib/gestures.ts). */
  gesture({ gesture }: KeyGesture): void {
    if (this.handsFree.running) {
      // A tap ends hands-free; so does the press that would start another.
      if (gesture === "tap" || gesture === "double-tap") void this.handsFree.end("ended");
      return;
    }
    switch (gesture) {
      case "down":
        this.at = this.deps.prefs().on ? this.deps.front() : Promise.resolve(null);
        // Words that wait stay until a hold replaces them.
        if (this.deps.prefs().on && this.state.phase !== "waiting") this.show({ phase: "key-down" });
        return;
      case "hold":
        return void this.begin();
      case "up":
        return void this.finish();
      case "double-tap":
        this.turn++;
        if (!this.deps.prefs().on || !this.deps.prefs().handsFree) return this.rest();
        return void this.handsFree.start(this.deps.front());
      case "tap":
        return this.rest();
      case "chord":
        return this.cancel();
    }
  }

  /** The key-down frame goes away; words that wait or a line that shows stay. */
  private rest(): void {
    if (this.state.phase === "key-down" || this.state.phase === "opening") this.show({ phase: "idle" });
  }

  /** What stops a listen from opening for the window `at`, or null: the microphone may open. */
  private async ready(at: Front | null): Promise<DictationTrouble | null> {
    const trouble = this.deps.trouble();
    if (trouble) return trouble;
    if (this.deps.busy()) return "busy";
    // A password field never opens the microphone.
    const [secret, muted] = await Promise.all([at ? this.deps.secret(at) : null, this.deps.muted()]);
    if (secret === true) return "secret";
    return muted ? "muted" : null;
  }

  /** The key is a hold: the microphone opens, unless something says it must not. */
  private async begin(): Promise<void> {
    if (!this.deps.prefs().on) return;
    const turn = ++this.turn;
    const hold: Dictation["hold"] = { opened: null, at: this.at };
    this.hold = hold;
    this.show({ phase: "opening" });
    const trouble = await this.ready(await hold.at);
    if (turn !== this.turn) return;
    if (trouble) {
      this.hold = null;
      return this.notice(trouble);
    }
    const language = this.deps.language;
    hold.opened = this.deps.service.call("listen", language ? { language } : {}).then(
      () => true,
      (error) => {
        if (turn === this.turn) {
          this.hold = null;
          this.notice(troubleOf(error));
        }
        return false;
      },
    );
    if (!(await hold.opened) || turn !== this.turn || this.hold !== hold) return;
    const hint = this.deps.taught() ? null : HINT;
    if (hint) this.deps.teach();
    this.show({ phase: "listening", text: "", handsFree: false, endsAt: this.now() + DICTATION_LIMITS.hold, hint });
    this.limits = [
      // A held key with nothing said ends by itself.
      this.timers.set(() => {
        if (this.state.phase === "listening" && this.state.text === "") this.silent();
      }, DICTATION_LIMITS.silentHold),
      this.timers.set(() => void this.finish("limit"), DICTATION_LIMITS.hold),
    ];
  }

  private silent(): void {
    this.cancel();
    this.notice("nothing-said");
  }

  /** The key came up (or the limit came): the words, tidied and typed. */
  private async finish(limit?: "limit"): Promise<void> {
    const hold = this.hold;
    this.hold = null;
    this.clearLimits();
    if (!hold) return this.rest();
    const turn = ++this.turn;
    if (!hold.opened) return this.show({ phase: "idle" });
    this.show({ phase: "tidying", text: this.state.phase === "listening" ? this.state.text : "" });
    if (!(await hold.opened) || turn !== this.turn) return;
    let text: string;
    try {
      text = maybe(HeardText, await this.deps.service.call("listen.stop"))?.text.trim() ?? "";
    } catch (error) {
      if (turn === this.turn) this.notice(troubleOf(error));
      return;
    }
    if (turn !== this.turn) return;
    if (text === "") return this.notice(limit ?? "nothing-said");
    const landing = await land({ ...this.deps, timers: this.timers }, text, await hold.at);
    if (turn !== this.turn) return;
    this.show(limit && landing.state.phase === "landed" ? { ...landing.state, line: `${landing.state.line} Time limit.` } : landing.state);
  }

  /** Nothing was meant: the microphone closes and nothing is heard. */
  private cancel(): void {
    const hold = this.hold;
    this.hold = null;
    this.clearLimits();
    this.turn++;
    if (hold?.opened) void hold.opened.then((opened) => opened && this.deps.service.call("listen.cancel").catch(() => {}));
    if (["key-down", "opening", "listening", "tidying"].includes(this.state.phase)) this.show({ phase: "idle" });
  }

  private event(event: HearingEvent): void {
    if (this.handsFree.running) return this.handsFree.event(event);
    if (this.state.phase !== "listening" || !this.hold) return;
    if (event.event === "level" && "level" in event) this.deps.hub.level.set(event.level);
    if (event.event === "partial" && "text" in event) this.show({ ...this.state, text: event.text, hint: null });
    if (event.event === "error" && "message" in event) {
      this.cancel();
      this.notice(troubleOf(new Error(event.message)), event.message);
    }
  }

  /** What the capsule asks (shared/pill/dictation.ts `DictationCommand`). */
  private command(command: DictationCommand): void {
    const state = this.state;
    switch (command.do) {
      case "copy": {
        if (state.phase !== "waiting" && state.phase !== "landed") return;
        const text = command.heard ? state.heard : state.phase === "waiting" ? state.text : state.typed;
        void this.deps.copy(text);
        // Copied, the words need not wait any longer.
        if (state.phase === "waiting") this.show({ phase: "idle" });
        return;
      }
      case "finish":
        if (this.handsFree.running) return void this.handsFree.end("ended");
        return void this.finish();
      case "dismiss":
        return this.stop();
      case "type":
        return void this.type(command.text);
    }
  }

  /** Words from elsewhere (Dashi's capsule's "Type it instead") land as a dictation would. */
  private async type(words: string): Promise<void> {
    const text = words.trim();
    if (text === "") return;
    this.stop();
    const turn = this.turn;
    this.show({ phase: "tidying", text });
    const landing = await land({ ...this.deps, timers: this.timers }, text, null);
    if (turn === this.turn) this.show(landing.state);
  }

  /** Everything stops and nothing shows (the lock, Close, Voice turned off). */
  stop(): void {
    if (this.handsFree.running) this.handsFree.drop();
    this.cancel();
    this.show({ phase: "idle" });
  }

  close(): void {
    this.stop();
    for (const off of this.offs) off();
  }
}
