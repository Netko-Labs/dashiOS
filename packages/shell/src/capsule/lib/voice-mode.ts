/**
 * Voice mode over 0.8's loop (docs/night-0.9-contract.md, "capsule"): what
 * the voice controller's chip and the launcher's Ask tasks do becomes one
 * `VoiceModeState` at a time, and `asks`, the things that wait for the
 * person. A spoken plan's ask opens its card by itself, and so does an
 * agent's question; a typed plan's waits for the bar. While a spoken plan's
 * card is up, the next thing heard is its answer: "yes" or "no" as the whole
 * of what was said.
 */

import { CARD_ARM_MS, type KeyGesture, type PillAsk, type PillHub, type VoiceModeCommand, type VoiceModeState } from "../../shared/pill/index.ts";
import { realTimers, type Timers } from "../../shared/time/index.ts";
import type { OpenCard, Reading } from "../types.ts";
import { Hearing } from "./hearing.ts";
import { cardContent, READING_CHARS } from "./model.ts";
import { Questions } from "./questions.ts";
import { cardId, type Task, type TaskSource, type VoiceSource } from "./sources.ts";
import { permissionsOf, voiceStateOf } from "./told.ts";
import { doneLine, planSpoken, spokenYesNo } from "./words.ts";

export interface VoiceModeDeps {
  hub: PillHub;
  voice: VoiceSource | null;
  /** Null until the launcher's agents have started. */
  tasks(): TaskSource | null;
  /** The card that is open changed. */
  onCard(card: OpenCard | null): void;
  timers?: Timers;
  now?(): number;
}

/** How long "Done", "Stopped" and a notice of the capsule's own stay. */
const STAYS_MS = 4000;
/** How long an answer to read stays, unless it is closed or the person talks again. */
const READING_STAYS_MS = 120_000;
/** A spoken yes counts for the run that follows it at once. */
const SAID_YES_MS = 2000;

export class VoiceMode {
  readonly questions: Questions;
  private readonly timers: Timers;
  private readonly offs: Array<() => void> = [];
  private watched: TaskSource | null = null;
  private readonly seen = new Map<string, Task["phase"]>();
  private readonly spoken = new Set<string>();
  private readonly opened = new Set<string>();
  private readonly since = new Map<string, number>();
  private card: OpenCard | null = null;
  private reading: Reading | null = null;
  /** A state of the capsule's own that no chip says: key-down, done, stopped. */
  private own: { state: VoiceModeState; timer: unknown } | null = null;
  private readonly hearing: Hearing;
  /** The plan the person said yes to, and when: the yes is that task's, no other's. */
  private saidYesTo: { task: string; at: number } | null = null;

  constructor(private readonly deps: VoiceModeDeps) {
    this.timers = deps.timers ?? realTimers;
    this.hearing = new Hearing(deps.voice, this.timers);
    this.questions = new Questions(
      this.timers,
      () => this.now(),
      () => this.refresh(),
    );
    const { hub, voice } = deps;
    if (voice) {
      this.offs.push(voice.subscribe(() => this.refresh()));
      this.offs.push(voice.level.subscribe(() => hub.dictation.getSnapshot().phase === "idle" && hub.level.set(voice.level.getSnapshot())));
    }
    this.offs.push(hub.voiceCommands.handle((command) => this.command(command)));
    this.offs.push(hub.keys.listen((gesture) => this.key(gesture)));
    this.refresh();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Whether the person said yes to `task`'s card just now: counts as their own press for that task's run (boot/agents.ts), once. */
  saidYes(task: string): boolean {
    const said = this.saidYesTo;
    if (!said || said.task !== task) return false;
    this.saidYesTo = null;
    return this.now() - said.at <= SAID_YES_MS;
  }

  /** How the person answers by voice, or null when they can't. */
  talkKey(): string | null {
    return this.deps.voice?.talkKey() ?? null;
  }

  private tasks(): readonly Task[] {
    const source = this.deps.tasks();
    if (source && source !== this.watched) {
      this.watched = source;
      this.offs.push(source.subscribe(() => this.refresh()));
    }
    return source?.getSnapshot() ?? [];
  }

  private show(state: VoiceModeState, ms: number | null): void {
    if (this.own) this.timers.clear(this.own.timer);
    const own = { state, timer: ms === null ? null : this.timers.set(() => this.own === own && this.clearOwn(), ms) };
    this.own = own;
    this.refresh();
  }

  private clearOwn(): void {
    if (this.own) this.timers.clear(this.own.timer);
    this.own = null;
    this.refresh();
  }

  private key(gesture: KeyGesture): void {
    if (gesture.key !== "dashi") return;
    if (gesture.gesture === "down" && this.deps.hub.voiceMode.getSnapshot().phase === "idle" && !this.card) return this.show({ phase: "key-down" }, 2000);
    if (this.own?.state.phase === "key-down") this.clearOwn();
    // A tap while a card is up gives the card the keyboard (Return is then yes).
    if (gesture.gesture === "tap" && this.card && !this.card.keyboard) this.setCard({ ...this.card, keyboard: true });
  }

  /** The tasks' news: which were spoken, and what a spoken one that ended leaves in the capsule. */
  private follow(tasks: readonly Task[]): void {
    const chip = this.deps.voice?.getSnapshot() ?? null;
    for (const task of tasks) {
      const before = this.seen.get(task.id);
      this.seen.set(task.id, task.phase);
      if (before === undefined && chip?.kind === "thinking" && chip.text.trim() === task.request) this.spoken.add(task.id);
      if (before === task.phase || !this.spoken.has(task.id)) continue;
      if (before === "running" && task.phase === "done") {
        const { line, ok } = doneLine(task.steps);
        const until = this.now() + STAYS_MS;
        this.show(ok ? { phase: "done", line, until } : { phase: "notice", line, go: "launcher", until }, STAYS_MS);
      }
      // An answer too long for the line is read whole in the card.
      if (task.phase === "done" && task.steps.length === 0 && task.said.length > READING_CHARS)
        this.read({ id: task.id, request: task.request, text: task.said });
    }
  }

  /** A long answer opens in the card, and closes by itself after a while (nothing waits on it). */
  private read(reading: Reading): void {
    this.reading = reading;
    this.timers.set(() => {
      if (this.reading !== reading) return;
      this.reading = null;
      this.refresh();
    }, READING_STAYS_MS);
  }

  /** Read 0.8's state again and tell the hub what changed. */
  refresh(): void {
    const tasks = this.tasks();
    this.follow(tasks);
    // An answer being read goes when the person talks to Dashi again.
    if (this.deps.voice?.getSnapshot()?.kind === "listening") this.reading = null;
    const { hub } = this.deps;
    const asks = [...permissionsOf(tasks, this.spoken, this.since, this.now()), ...this.questions.asks()].sort((a, b) => a.since - b.since);
    if (JSON.stringify(asks) !== JSON.stringify(hub.asks.getSnapshot())) hub.asks.set(asks);
    const state = voiceStateOf(this.deps.voice?.getSnapshot() ?? null, this.own?.state ?? null, tasks, this.spoken, this.now() + STAYS_MS);
    if (JSON.stringify(state) !== JSON.stringify(hub.voiceMode.getSnapshot())) hub.voiceMode.set(state);
    this.chooseCard(hub.asks.getSnapshot());
  }

  /** The card: the oldest ask that opens by itself or was opened, else a long answer to read. */
  private chooseCard(asks: readonly PillAsk[]): void {
    const ask = asks.find((each) => each.kind === "question" || each.spoken || this.opened.has(each.id));
    const what: OpenCard["what"] | null = ask ? { ask } : this.reading ? { reading: this.reading } : null;
    if (!what) return this.setCard(null);
    const next: OpenCard = { what, keyboard: false, armsAt: this.now() + CARD_ARM_MS, hears: false, from: 0 };
    if (this.card && cardId(this.card) === cardId(next)) {
      if (JSON.stringify(this.card.what) !== JSON.stringify(what)) this.setCard({ ...this.card, what });
      return;
    }
    const hears = ask !== undefined && (ask.kind === "question" || ask.spoken) && this.talkKey() !== null;
    this.setCard({ ...next, hears });
    if (!ask || !hears) return;
    if (ask.kind === "question") {
      const id = ask.id;
      return this.hear(id, this.questions.spokenOf(id), (text) => this.questions.answer(id, { text, by: "voice" }));
    }
    const said = this.watched?.getSnapshot().find((task) => task.id === ask.task)?.said ?? "";
    this.hear(ask.id, planSpoken(said, ask.steps), (text) => this.heardPlan(ask.id, text));
  }

  private setCard(card: OpenCard | null): void {
    if (card === this.card) return;
    if (!card || !this.card || cardId(card) !== cardId(this.card)) this.hearing.stop();
    this.card = card;
    this.deps.onCard(card);
  }

  /** What was heard while a spoken plan's card is up: yes or no as the whole of it, else it is asked again. */
  private heardPlan(id: string, text: string): void {
    const yes = spokenYesNo(text);
    if (yes === null) return this.hear(id, "Say yes or no.", (again) => this.heardPlan(id, again));
    if (yes) this.saidYesTo = { task: id, at: this.now() };
    this.answerPermission(id, yes, true);
  }

  /** Say `words`; the next thing heard, while that card is still up, is its answer. */
  private hear(id: string, words: string, heard: (text: string) => void): void {
    this.hearing.start(words, () => this.cardIs(id), heard);
  }

  private cardIs(id: string): boolean {
    return this.card !== null && "ask" in this.card.what && this.card.what.ask.id === id;
  }

  private answerPermission(id: string, yes: boolean, said = false): void {
    const tasks = this.watched;
    // The buttons are not armed yet: a click meant for what was there before answers nothing.
    if (yes && !said && this.card && this.cardIs(id) && this.now() < this.card.armsAt) return;
    // No yes, pressed or said, before the end of it has been shown.
    if (yes && this.card && this.cardIs(id) && !cardContent(this.card.what, "", this.card.from).end) {
      if (said) this.hear(id, "Read it all first, then say yes.", (again) => this.heardPlan(id, again));
      return;
    }
    this.opened.delete(id);
    this.hearing.stop();
    if (!yes) {
      tasks?.stop(id);
      return this.show({ phase: "stopped", until: this.now() + 2500 }, 2500);
    }
    // From here its steps show in the capsule; the run itself asks whether the person pressed (agents/ask/lib/tasks.ts).
    this.spoken.add(id);
    void tasks?.run(id).then(() => {
      const refused = tasks
        .getSnapshot()
        .find((task) => task.id === id)
        ?.steps.some((step) => step.state.kind === "not-allowed");
      if (refused)
        this.show(
          { phase: "notice", line: "Dashi couldn't tell that was you. Run it from the launcher.", go: "launcher", until: this.now() + STAYS_MS },
          STAYS_MS,
        );
      else this.refresh();
    });
    this.refresh();
  }

  private command(command: VoiceModeCommand): void {
    switch (command.do) {
      case "answer-permission":
        return this.answerPermission(command.id, command.yes);
      case "answer-question":
        return this.questions.answer(command.id, command.text === "" ? { none: "declined" } : { text: command.text, by: "typing" });
      case "open-ask":
        if (this.deps.hub.asks.getSnapshot().some((ask) => ask.id === command.id)) this.opened.add(command.id);
        return this.refresh();
      case "stop":
        this.deps.voice?.stop();
        if (command.task) this.watched?.stop(command.task);
        return this.show({ phase: "stopped", until: this.now() + 2500 }, 2500);
      case "type-instead":
        return this.typeInstead();
    }
  }

  /** Not for Dashi after all: stop the ask, and land the words as a dictation. */
  private typeInstead(): void {
    const state = this.deps.hub.voiceMode.getSnapshot();
    if (state.phase !== "heard" || state.text.trim() === "") return;
    // Stopping the voice loop stops the task it asked (voice/asker.ts).
    this.deps.voice?.stop();
    if (this.deps.hub.dictationCommands.send({ do: "type", text: state.text })) return this.clearOwn();
    this.show({ phase: "notice", line: "Dictation isn't on, so nothing was typed.", go: "voice", until: this.now() + STAYS_MS }, STAYS_MS);
  }

  /** A press or a key on the card that is not a yes or a no. */
  cardAction(action: "read" | "close" | "unfocus"): void {
    const card = this.card;
    if (!card) return;
    if (action === "unfocus") return this.setCard({ ...card, keyboard: false });
    const content = cardContent(card.what, "", card.from);
    // "Read it all" scrolls the card in place; its buttons arm again, so a second press meant for it is no yes.
    if (action === "read" && !content.end) return this.setCard({ ...card, from: content.next, armsAt: this.now() + CARD_ARM_MS });
    if ("reading" in card.what) {
      this.reading = null;
      return this.refresh();
    }
    // A question to be typed, or with more choices than fit: it is answered where it lives.
    const ask = card.what.ask;
    if (ask.kind === "question") this.questions.elsewhere(ask.id);
  }

  close(): void {
    for (const off of this.offs) off();
    this.hearing.stop();
    if (this.own) this.timers.clear(this.own.timer);
    this.questions.close();
  }
}
