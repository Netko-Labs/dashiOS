/**
 * Dashi's assistant (decisions.md D147 to D149, D260 to D262): one
 * conversation while it is open, spoken to the capsule or typed in the
 * launcher, and each thing said answered by doing it with the tools any
 * agent has on `dashi-mcp`, in a real loop.
 *
 * - Some words are acted on by rule, before any model: the ones that end
 *   the conversation, "undo that", and "remember that…".
 * - The ask is driven one of two ways on the same server, with the same
 *   policy: a harness the person set up, in Dashi's sandbox (lib/harness.ts),
 *   or the shell's own loop for a key or a local model (lib/model-loop.ts).
 *   GPT has no loop yet: spoken, it is planned (the capsule's card); typed,
 *   the launcher says it is not there yet. The launcher never plans.
 * - Every turn, spoken or typed, goes into the transcript the launcher shows
 *   (transcript.ts); a typed turn's question waits there (lib/turn.ts).
 * - Keep working on it: the turn at work goes on by itself, with room for a
 *   longer job, and a notification says when it is done.
 */

import { realTimers, type Timers } from "../../shared/time/index.ts";
import { AnswerError, type AnswerFailure, isHarnessId, settingWords, type Undo } from "../ask/index.ts";
import { ALL_SCOPES } from "../consent.ts";
import type { TaskPolicy } from "../lib/session/session-types.ts";
import type { PersonAnswer } from "../presence.ts";
import type { Call } from "../tools/index.ts";
import type { Moment } from "./context.ts";
import { Conversation, fileTalkLog } from "./conversation.ts";
import { modelFor, modelLabel } from "./lib/channel.ts";
import { type Ended, finishTurn } from "./lib/record.ts";
import { Running, stoppedWords } from "./lib/running.ts";
import { lastWords, Turn, typedGate } from "./lib/turn.ts";
import { isAbort, viaHarness, viaModel } from "./lib/ways.ts";
import { asksRemember, asksUndo, endsTalk } from "./lib/words.ts";
import { type By, Transcript } from "./transcript.ts";
import type { Assistant, AssistantOptions, Hears, SpokenAnswer } from "./types.ts";

const NO_HEARS: Hears = { say: () => {}, step: () => {} };
const GO: Partial<Record<AnswerFailure, "agents" | "launcher">> = {
  "no-key": "agents",
  "not-installed": "agents",
  "no-model": "agents",
  "not-signed-in": "launcher",
};

/** How an ask is answered: the loop through a harness or the shell's own, plan mode (GPT, spoken only), or nothing. */
export function wayOf(choice: string | undefined): "harness" | "model" | "plan" | "none" {
  if (choice === undefined || choice === "none") return "none";
  if (isHarnessId(choice)) return "harness";
  return choice === "claude" || choice === "local" ? "model" : "plan";
}

class Core {
  readonly talk: Conversation;
  readonly transcript: Transcript;
  private readonly timers: Timers;
  private turn: Turn | null = null;
  private prepared: Promise<Moment> | null = null;
  private asks = 0;
  /** The policy of the ask under way; a connection that comes between asks gets it too, and its calls are refused. */
  private allowedPolicy: TaskPolicy | null = null;

  constructor(private readonly options: AssistantOptions) {
    this.timers = options.timers ?? realTimers;
    this.transcript = new Transcript(() => this.now());
    this.talk = new Conversation({
      timers: this.timers,
      now: () => this.now(),
      log: options.talkLog ?? fileTalkLog(),
      ...(options.newId ? { newId: options.newId } : {}),
      // Whatever still runs for it stops with it.
      closed: (id) => {
        options.agents()?.stopTask(id);
        this.transcript.ended();
      },
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** No first-use sheet (decisions.md D260): choosing who answers is the consent; only the critical list asks. */
  private policy(): TaskPolicy {
    return {
      granted: [...ALL_SCOPES],
      refused: [],
      window: null,
      name: this.options.name(),
      sites: this.talk.sites,
      assistant: {
        refuses: () => this.turn?.run.refuses() ?? "The person's request is over. Make no more calls.",
        // Said in the step line: the person is watching, and a site is kept for good only by them, in Settings.
        site: (site) => this.turn?.hears.step(`Using ${site} for the first time`),
        ...typedGate(() => this.turn, this.transcript),
      },
    };
  }

  private undoOf(call: Call): Undo | null {
    if (call.name !== "set_setting") return null;
    const address = this.options.setSettingAddress();
    const was = this.options.settingNow(call.setting);
    if (!address || (typeof was !== "string" && typeof was !== "number" && typeof was !== "boolean") || was === call.value) return null;
    return { address, args: { name: call.setting, value: was }, title: settingWords(call.setting, was) };
  }

  /** "Undo that": the last change that can be put back. */
  private async undoLast(): Promise<SpokenAnswer> {
    const entry = this.talk.undos.findLast((each) => !each.undone);
    if (!entry) return { say: "There is nothing to undo." };
    const outcome = await this.options.runUndo(entry.undo);
    if (!outcome.ok) return { say: "I couldn't put that back." };
    entry.undone = true;
    const said = "Done. I put that back.";
    if (this.talk.id) this.talk.record(this.talk.id, { time: this.now(), asked: "undo that", said, steps: [entry.undo.title] });
    return { say: said };
  }

  private failure(error: unknown): SpokenAnswer {
    const go = error instanceof AnswerError ? GO[error.failure] : undefined;
    if (error instanceof AnswerError) return { say: error.message, failed: go ? { go } : {} };
    this.log(`assistant failed: ${error instanceof Error ? error.message : String(error)}`);
    return { say: "Something went wrong, and I couldn't do that.", failed: {} };
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  private async loop(way: "harness" | "model", words: string, signal: AbortSignal, hears: Hears, by: By): Promise<SpokenAnswer> {
    const { options, talk } = this;
    const { id } = talk.begin();
    const settings = options.settings();
    const choice = settings.agents.answerer;
    const model = modelFor(settings.agents.models, choice, by, settings.agents.localModel);
    const label = modelLabel(choice, model);
    const pen = this.transcript.begin(id, words, by, label);
    const moment = await (this.prepared ?? options.moment());
    this.prepared = null;
    const limits = { ...(options.maxCalls ? { maxCalls: options.maxCalls } : {}), ...(options.maxMs ? { maxMs: options.maxMs } : {}) };
    const both: Hears = {
      ...hears,
      say: (text) => {
        hears.say(text);
        pen.say(text);
      },
      step: (title) => {
        hears.step(title);
        pen.step(title);
      },
    };
    const deps = { timers: this.timers, now: () => this.now(), step: both.step, settled: pen.settle, undoOf: (call: Call) => this.undoOf(call), ...limits };
    const run = new Running(deps, signal);
    const turn = new Turn(run, both, by);
    this.turn = turn;
    this.allowedPolicy = this.policy();
    let said = "";
    let answer: SpokenAnswer;
    try {
      const ask = { options, talk, task: id, words, moment, run, say: both.say, spoke: hears.language, model };
      said = way === "harness" && isHarnessId(choice) ? await viaHarness(ask, choice) : await viaModel(ask, choice === "local", this.allowedPolicy);
      answer = { say: lastWords(run, said) };
    } catch (error) {
      // Stopped by the person: nothing more is said. Stopped by Dashi at a limit: where it is.
      if (isAbort(error) || run.signal.aborted) answer = { say: run.stopped ? stoppedWords(run) : "" };
      else answer = this.failure(error);
      options.agents()?.stopTask(id);
    } finally {
      run.end();
      if (this.turn === turn) this.turn = null;
    }
    const interrupted = signal.aborted || (run.signal.aborted && !run.stopped);
    pen.end(interrupted ? "stopped" : answer.failed ? "failed" : "done", { text: answer.say, ...(answer.failed ? { failed: answer.failed } : {}) });
    this.finish(id, words, run, { said, answer, interrupted, turn, label, way });
    return answer;
  }

  /** What an ask leaves (lib/record.ts): the exchange, the history, the log line, the notification or the voice. */
  private finish(id: string, words: string, run: Running, end: Ended): void {
    finishTurn({ options: this.options, talk: this.talk, now: this.now(), serial: ++this.asks }, id, words, run, end);
  }

  prepare(): void {
    this.prepared = this.options.moment();
    // Nothing waits on it if the listen comes to nothing.
    this.prepared.catch(() => {});
  }

  async ask(words: string, signal: AbortSignal, hears: Hears = NO_HEARS): Promise<SpokenAnswer> {
    const { options, talk } = this;
    const text = words.trim();
    const by = hears.by ?? "voice";
    if (options.locked()) return { say: "" };
    // Answered by rule: a typed one is still a turn in the launcher.
    const ruled = (answer: SpokenAnswer): SpokenAnswer => (by === "typing" ? this.ruled(text, answer) : answer);
    if (endsTalk(text)) {
      if (by === "typing" && talk.id) this.ruled(text, { say: "OK." });
      talk.end("said");
      return { say: "OK." };
    }
    if (asksUndo(text) && talk.open()) return ruled(await this.undoLast());
    // "Remember that…": the person's own words go into the file they can read and edit, and no model is asked.
    const fact = options.remember ? asksRemember(text) : null;
    if (fact !== null) return ruled({ say: options.remember?.(fact) ? "I'll remember that." : "I couldn't write that down." });
    const way = wayOf(options.settings().agents.answerer);
    if (way === "none") return ruled({ say: "Choose who answers in System Settings, Agents.", failed: { go: "agents" } });
    if (way === "plan")
      return by === "voice"
        ? options.planner.ask(text, signal)
        : ruled({ say: "Not yet: GPT needs Dashi's loop, which isn't built. Choose another answerer in System Settings, Agents.", failed: { go: "agents" } });
    try {
      return await this.loop(way, text, signal, hears, by);
    } catch (error) {
      return isAbort(error) ? { say: "" } : this.failure(error);
    }
  }

  /** A typed ask: its own stop, answered into the transcript; a turn still at work is stopped first. */
  type(words: string): boolean {
    if (this.options.locked() || !words.trim()) return false;
    this.stop();
    const controller = new AbortController();
    this.typing = controller;
    void this.ask(words, controller.signal, { say: () => {}, step: () => {}, by: "typing" }).then(() => {
      if (this.typing === controller) this.typing = null;
      this.talk.rested();
    });
    return true;
  }

  private typing: AbortController | null = null;

  /** A typed turn the loop never saw (answered by rule, or nobody to answer): written as a turn of its own. */
  private ruled(words: string, answer: SpokenAnswer): SpokenAnswer {
    const pen = this.transcript.begin(this.talk.begin().id, words, "typing", "");
    pen.end(answer.failed ? "failed" : "done", { text: answer.say, ...(answer.failed ? { failed: answer.failed } : {}) });
    return answer;
  }

  stop(): void {
    this.typing?.abort();
    this.typing = null;
    this.turn?.run.abort();
  }

  keepWorking(): boolean {
    const turn = this.turn;
    if (!turn || turn.background) return false;
    turn.keepWorking();
    this.transcript.setBackground(true);
    return true;
  }

  reply(answer: PersonAnswer): boolean {
    return this.transcript.reply(answer);
  }

  model(by: By): string | null {
    const { agents } = this.options.settings();
    if (wayOf(agents.answerer) === "none") return null;
    return modelLabel(agents.answerer, modelFor(agents.models, agents.answerer, by, agents.localModel));
  }

  background(task: string): boolean {
    return task === this.talk.id && this.turn?.background === true;
  }

  policyOf(task: string): TaskPolicy | null {
    return task === this.talk.id ? this.allowedPolicy : null;
  }

  before(task: string, call: Call): Undo | null {
    return task === this.talk.id && this.turn ? this.turn.run.before(call) : null;
  }

  after(task: string, ok: boolean): void {
    if (task === this.talk.id) this.turn?.run.after(ok);
  }
}

export function startAssistant(options: AssistantOptions): Assistant {
  const core = new Core(options);
  return {
    talk: core.talk,
    transcript: core.transcript,
    prepare: () => core.prepare(),
    ask: (words, signal, hears) => core.ask(words, signal, hears),
    type: (words) => core.type(words),
    stop: () => core.stop(),
    keepWorking: () => core.keepWorking(),
    reply: (answer) => core.reply(answer),
    background: (task) => core.background(task),
    model: (by) => core.model(by),
    policy: (task) => core.policyOf(task),
    before: (task, call) => core.before(task, call),
    after: (task, _undo, ok) => core.after(task, ok),
    close: () => core.talk.end("stopped"),
  };
}
