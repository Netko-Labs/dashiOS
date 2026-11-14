/**
 * The capsule piece, put together (boot/capsule.tsx starts it): the surface
 * at the bottom of the screen, what it draws from the hub (dictation's
 * state, voice mode's, the card), voice mode's adapter over 0.8's loop, and
 * the place rule. It draws nothing and has no window until something shows.
 */

import type { Bounds, NativeHostOptions, NativeHostTransport } from "@mirinjs/metal";
import { personAnswered } from "../agents/index.ts";
import { dockSign } from "../dock/index.ts";
import { CAPSULE_LAYER, cell, type PillHub } from "../shared/pill/index.ts";
import { realTimers, type Timers } from "../shared/time/index.ts";
import type { CardAnswer } from "./lib/card.tsx";
import { FakeTasks, FakeVoice, followScenes } from "./lib/fake.ts";
import { type LocateOutput, type LocateWindow, locate } from "./lib/locate.ts";
import { CAPSULE, CARD, SEAT } from "./lib/measures.ts";
import { shownOf } from "./lib/model.ts";
import { cardBottom, dockTop, placeOf } from "./lib/place.ts";
import { SCENES } from "./lib/scenes.ts";
import type { TaskSource, VoiceSource } from "./lib/sources.ts";
import { CapsuleSurface } from "./lib/surface.ts";
import { CapsuleView, type ViewState } from "./lib/view.tsx";
import { VoiceMode } from "./lib/voice-mode.ts";
import { bottomStack } from "./stack.ts";
import type { CardQuestion, OpenCard, Place, QuestionAnswer } from "./types.ts";

/** The compositor, as much as the capsule asks of it. */
export interface CapsuleCompositor {
  inputRegion(params: { namespace: string; rects: Array<{ x: number; y: number; width: number; height: number }> | null }): Promise<unknown>;
  inputOrigin(params: { namespace: string }): Promise<{ person: number | null; agent: number | null }>;
  outputs(): Promise<readonly LocateOutput[]>;
  windows(): Promise<readonly LocateWindow[]>;
  session(): Promise<{ pointer: { x: number; y: number } | null }>;
}

export interface CapsuleNeeds {
  hub: PillHub;
  compositor: CapsuleCompositor | null;
  /** 0.8's voice controller; null where there is none. */
  voice: VoiceSource | null;
  /** The launcher's Ask tasks; null until they start. */
  tasks(): TaskSource | null;
  reduceMotion(): boolean;
  openLauncher(): void;
  /** Start a Metal host with no window. */
  spawn(options: NativeHostOptions): NativeHostTransport;
  /** A file of scene names to play (lib/fake.ts): the fake stands in for the voice loop and the tasks. */
  fake?: string | undefined;
  timers?: Timers;
  now?(): number;
}

export interface Capsule {
  /** Whether the person's own press on the card, or their spoken yes, just answered it. */
  personAnswered(): Promise<boolean>;
  /** An agent's question in the card; "elsewhere" when the person would type it (the sheet has the field). */
  question(question: CardQuestion, signal?: AbortSignal): Promise<QuestionAnswer | "elsewhere">;
  /** Whether a question can go to the card now: the person can answer it by voice. */
  takesQuestions(): boolean;
  close(): void;
}

const HOME: Place = {
  seat: "home",
  bottom: dockTop({ shown: true, style: "dock", panel: null, output: undefined }) + SEAT.aboveDock,
  at: { centre: true },
  maxWidth: CAPSULE.maxWidth,
  tail: CAPSULE.tail,
};

/** The capsule that runs now, for the pieces that start before it (agent-sheets, the Ask tasks' press check). */
export const runningCapsule = cell<Capsule | null>(null);

class Running implements Capsule {
  private readonly state = cell<ViewState>({ shown: { kind: "none" }, place: HOME, cardBottom: SEAT.edge });
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly mode: VoiceMode;
  private readonly surface: CapsuleSurface;
  private readonly offs: Array<() => void>;
  private card: OpenCard | null = null;
  private where: { output: string | undefined; place: Place } = { output: undefined, place: HOME };
  /** What was showing when the place was last asked for. */
  private located = "";
  private region = "";

  constructor(private readonly needs: CapsuleNeeds) {
    const { hub } = needs;
    this.timers = needs.timers ?? realTimers;
    this.now = needs.now ?? Date.now;
    const fakeVoice = needs.fake ? new FakeVoice() : null;
    const fakeTasks = needs.fake ? new FakeTasks(this.timers, () => this.personAnswered()) : null;
    this.mode = new VoiceMode({
      hub,
      voice: fakeVoice ?? needs.voice,
      tasks: () => fakeTasks ?? needs.tasks(),
      onCard: (next) => {
        this.card = next;
        this.sync();
      },
      openLauncher: needs.openLauncher,
      timers: this.timers,
      now: this.now,
    });
    this.surface = new CapsuleSurface({ spawn: needs.spawn, element: this.view() });
    const sync = (): void => this.sync();
    this.offs = [hub.dictation.subscribe(sync), hub.voiceMode.subscribe(sync), dockSign.place.subscribe(sync)];
    if (needs.fake && fakeVoice && fakeTasks) {
      const stage = {
        hub,
        voice: fakeVoice,
        tasks: fakeTasks,
        timers: this.timers,
        now: this.now,
        question: (question: CardQuestion) => void this.mode.questions.ask(question),
      };
      const play = (name: string): void => (SCENES[name] ?? (() => console.error(`dashi-shell: the capsule's fake has no scene “${name}”`)))(stage);
      this.offs.push(followScenes(needs.fake, play, this.timers));
    }
    this.sync();
  }

  private view() {
    const { hub } = this.needs;
    return (
      <CapsuleView
        state={this.state}
        level={hub.level}
        persona={hub.persona}
        still={this.needs.reduceMotion}
        talkKey={() => this.mode.talkKey()}
        now={this.now}
        onDictation={(command) => void hub.dictationCommands.send(command)}
        onVoice={(command) => void hub.voiceCommands.send(command)}
        onCard={(answer) => this.answer(answer)}
        onBounds={(bounds) => this.state.getSnapshot().shown.kind !== "none" && this.clickable([bounds])}
      />
    );
  }

  /** The pointer is taken only on what is drawn: the rest of the surface lets it through. */
  private clickable(rects: Bounds[]): void {
    const wire = rects.map(({ x, y, width, height }) => ({ x, y, width, height }));
    const key = JSON.stringify(wire);
    if (key === this.region) return;
    this.region = key;
    this.needs.compositor
      ?.inputRegion({ namespace: CAPSULE_LAYER, rects: wire })
      .catch((error) => console.error("dashi-shell: the capsule's surface takes clicks across the screen:", error));
  }

  /** A press or a key on the card. */
  private answer(answer: CardAnswer): void {
    const { card, mode } = this;
    const { hub } = this.needs;
    if (!card) return;
    if (answer.do === "read" || answer.do === "close" || answer.do === "unfocus") return mode.cardAction(answer.do);
    if ("reading" in card.what) return mode.cardAction("close");
    const ask = card.what.ask;
    if (ask.kind === "permission") hub.voiceCommands.send({ do: "answer-permission", id: ask.id, yes: answer.do === "yes" });
    else hub.voiceCommands.send({ do: "answer-question", id: ask.id, text: answer.do === "choose" ? answer.text : "" });
  }

  /** Ask where the windows and the screens are, and move if the seat changed. */
  private async find(): Promise<void> {
    const { compositor } = this.needs;
    if (!compositor) return;
    try {
      const [outputs, windows, session] = await Promise.all([
        compositor.outputs(),
        compositor.windows().catch(() => []),
        compositor.session().catch(() => null),
      ]);
      const found = locate(outputs, windows, session?.pointer ?? null, dockSign.place.getSnapshot());
      if (!found) return;
      this.where = { output: outputs.length > 1 ? found.output : undefined, place: placeOf(found.input) };
      this.sync();
    } catch {
      // Home, on the compositor's screen, is where it stays.
    }
  }

  private sync(): void {
    const { hub } = this.needs;
    const shown = shownOf(hub.dictation.getSnapshot(), hub.voiceMode.getSnapshot(), this.card);
    const dock = dockSign.place.getSnapshot();
    dockSign.asking.set(shown.kind === "card" && "ask" in shown.card.what);
    if (shown.kind === "none") {
      this.located = "";
      this.state.set({ ...this.state.getSnapshot(), shown });
      this.clickable([]);
      this.surface.hide();
      return bottomStack.set(null);
    }
    // Where it sits is asked when it appears and when what it shows changes kind, not at every word.
    const key = shown.kind === "card" ? "card" : `${shown.kind}:${shown.state.phase}`;
    if (key !== this.located) {
      this.located = key;
      void this.find();
    }
    const bottom = cardBottom(dock, dock?.shown === true);
    this.state.set({ shown, place: this.where.place, cardBottom: bottom });
    // A card stands on the Dock, on the Dock's screen.
    const output = shown.kind === "card" ? (dock?.output ?? this.where.output) : this.where.output;
    this.surface.show(output, shown.kind === "card" && shown.card.keyboard);
    bottomStack.set({ top: shown.kind === "card" ? bottom + CARD.maxHeight : this.where.place.bottom + CAPSULE.height, output });
  }

  async personAnswered(): Promise<boolean> {
    const { compositor } = this.needs;
    if (this.mode.saidYes()) return true;
    return compositor ? personAnswered((params) => compositor.inputOrigin(params), CAPSULE_LAYER) : false;
  }

  question(question: CardQuestion, signal?: AbortSignal): Promise<QuestionAnswer | "elsewhere"> {
    return this.mode.questions.ask(question, signal);
  }

  takesQuestions(): boolean {
    return this.mode.talkKey() !== null;
  }

  close(): void {
    for (const off of this.offs) off();
    runningCapsule.set(null);
    this.mode.close();
    this.surface.close();
    dockSign.asking.set(false);
    bottomStack.set(null);
  }
}

export function startCapsule(needs: CapsuleNeeds): Capsule {
  const capsule = new Running(needs);
  runningCapsule.set(capsule);
  return capsule;
}
