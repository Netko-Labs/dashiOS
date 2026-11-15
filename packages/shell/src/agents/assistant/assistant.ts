/**
 * Dashi's assistant, as it is talked to (decisions.md D147 to D149): one
 * conversation while it is open, and each thing said answered by doing it
 * with the tools any agent has on `dashi-mcp`, in a real loop.
 *
 * - Some words are acted on by rule, before any model: the ones that end
 *   the conversation, and "undo that".
 * - "Ask before every step" (Settings › Voice), and an answerer with no loop
 *   yet (GPT), keep plan mode: the launcher's planner and its card.
 * - Otherwise the ask is driven one of two ways on the same server, with the
 *   same policy: a harness the person set up, in Dashi's sandbox
 *   (lib/harness.ts), or the shell's own loop for a key or a local model
 *   (lib/model-loop.ts). Every call is told here by the server's hooks, so
 *   the capsule's line, the cap, Undo and the history are one code.
 *
 * Say, do, say: the model says a line before its first call (its prompt),
 * each call is the capsule's line in Dashi's words, and what it says at the
 * end is spoken; Dashi adds the offer to undo when something can be.
 */

import { realTimers, type Timers } from "../../shared/time/index.ts";
import { AnswerError, type AnswerFailure, isHarnessId, settingWords, type Undo } from "../ask/index.ts";
import type { Scope } from "../consent.ts";
import type { TaskPolicy } from "../lib/session/session-types.ts";
import type { Call } from "../tools/index.ts";
import type { Moment } from "./context.ts";
import { Conversation, fileTalkLog } from "./conversation.ts";
import { firstUse } from "./lib/first-use.ts";
import { Running, stoppedWords } from "./lib/running.ts";
import { isAbort, viaHarness, viaModel } from "./lib/ways.ts";
import { asksRemember, asksUndo, endsTalk } from "./lib/words.ts";
import type { Assistant, AssistantOptions, Hears, SpokenAnswer } from "./types.ts";

const NO_HEARS: Hears = { say: () => {}, step: () => {} };
const GO: Partial<Record<AnswerFailure, "agents" | "launcher">> = {
  "no-key": "agents",
  "not-installed": "agents",
  "no-model": "agents",
  "not-signed-in": "launcher",
};

/** How an ask is answered: the loop through a harness or the shell's own, or plan mode. */
export function wayOf(choice: string | undefined, askEveryStep: boolean): "harness" | "model" | "plan" {
  if (askEveryStep || choice === undefined) return "plan";
  if (isHarnessId(choice)) return "harness";
  return choice === "claude" || choice === "local" ? "model" : "plan";
}

class Core {
  readonly talk: Conversation;
  private readonly timers: Timers;
  private running: Running | null = null;
  private hearing: Hears = NO_HEARS;
  private prepared: Promise<Moment> | null = null;
  /** The scopes the person ticked on the first-use sheet, for this session; null until it was answered. */
  private allowed: Set<Scope> | null = null;
  private asks = 0;
  /** The policy of the ask under way; a connection that comes between asks gets it too, and its calls are refused. */
  private allowedPolicy: TaskPolicy | null = null;

  constructor(private readonly options: AssistantOptions) {
    this.timers = options.timers ?? realTimers;
    this.talk = new Conversation({
      timers: this.timers,
      now: () => this.now(),
      log: options.talkLog ?? fileTalkLog(),
      ...(options.newId ? { newId: options.newId } : {}),
      // Whatever still runs for it stops with it.
      closed: (id) => options.agents()?.stopTask(id),
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  /** The first use: one sheet naming what the assistant may see and do, once (lib/first-use.ts). */
  private async granted(signal: AbortSignal): Promise<Set<Scope> | null> {
    this.allowed ??= await firstUse(this.options, signal);
    return this.allowed;
  }

  private policyFor(scopes: ReadonlySet<Scope>): TaskPolicy {
    return {
      granted: [...scopes],
      refused: [],
      window: null,
      name: this.options.name(),
      sites: this.talk.sites,
      assistant: {
        refuses: () => (this.running ? this.running.refuses() : "The person's request is over. Make no more calls."),
        // Said in the capsule's line: the person is watching, and a site is kept for good only by them, in Settings.
        site: (site) => this.hearing.step(`Using ${site} for the first time`),
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

  private async loop(way: "harness" | "model", words: string, signal: AbortSignal): Promise<SpokenAnswer> {
    const { options, talk } = this;
    const scopes = await this.granted(signal);
    if (!scopes) return { say: "I need your OK to see and use this computer. Ask me again and allow it.", failed: { go: "agents" } };
    const { id } = talk.begin();
    const moment = await (this.prepared ?? options.moment());
    this.prepared = null;
    const choice = options.settings().agents.answerer;
    const limits = { ...(options.maxCalls ? { maxCalls: options.maxCalls } : {}), ...(options.maxMs ? { maxMs: options.maxMs } : {}) };
    const run = new Running(
      { timers: this.timers, now: () => this.now(), step: (title) => this.hearing.step(title), undoOf: (call) => this.undoOf(call), ...limits },
      signal,
    );
    this.running = run;
    this.allowedPolicy = this.policyFor(scopes);
    let said = "";
    let answer: SpokenAnswer;
    try {
      const ask = { options, talk, task: id, words, moment, run, say: this.hearing.say, spoke: this.hearing.language };
      said = way === "harness" && isHarnessId(choice) ? await viaHarness(ask, choice) : await viaModel(ask, choice === "local", this.policyFor(scopes));
      answer = { say: lastWords(run, said) };
    } catch (error) {
      // Stopped by the person: nothing more is said. Stopped by Dashi at a limit: where it is.
      if (isAbort(error) || run.signal.aborted) answer = { say: run.stopped ? stoppedWords(run) : "" };
      else answer = this.failure(error);
      options.agents()?.stopTask(id);
    } finally {
      run.end();
      this.running = null;
    }
    const interrupted = signal.aborted;
    const steps = run.steps.map((step) => step.title);
    const all = [said.trim(), answer.failed ? "" : answer.say].filter(Boolean).join(" ");
    talk.record(id, { time: this.now(), asked: words, said: all, steps, ...(interrupted ? { interrupted: true as const } : {}) });
    this.keepHistory(id, words, run);
    this.log(
      `assistant asked=${JSON.stringify(words.slice(0, 80))} way=${way} calls=${steps.length} ended=${interrupted ? "stopped" : (run.stopped ?? (answer.failed ? "failed" : "done"))}`,
    );
    return answer;
  }

  /** The ask's steps in the launcher's history, with what each settings change would be put back to. */
  private keepHistory(id: string, words: string, run: Running): void {
    if (run.steps.length === 0) return;
    for (const step of run.steps) if (step.undo && step.ok) this.talk.undos.push({ undo: step.undo, undone: false });
    this.options.history?.add({
      task: `talk-${id}.${++this.asks}`,
      time: Math.floor(this.now() / 1000),
      agent: this.options.name(),
      request: words,
      steps: run.steps.map((step) => ({
        title: step.title,
        outcome: step.ok === false ? ("failed" as const) : ("done" as const),
        ...(step.undo && step.ok ? { undo: step.undo } : {}),
      })),
    });
  }

  prepare(): void {
    this.prepared = this.options.moment();
    // Nothing waits on it if the listen comes to nothing.
    this.prepared.catch(() => {});
  }

  async ask(words: string, signal: AbortSignal, hears: Hears = NO_HEARS): Promise<SpokenAnswer> {
    const { options, talk } = this;
    const text = words.trim();
    if (options.locked()) return { say: "" };
    if (endsTalk(text)) {
      talk.end("said");
      return { say: "OK." };
    }
    if (asksUndo(text) && talk.open()) return this.undoLast();
    // "Remember that…": the person's own words go into the file they can read and edit, and no model is asked.
    const fact = options.remember ? asksRemember(text) : null;
    if (fact !== null) return { say: options.remember?.(fact) ? "I'll remember that." : "I couldn't write that down." };
    const settings = options.settings();
    const way = wayOf(settings.agents.answerer, settings.voice.askEveryStep === true);
    if (way === "plan") return options.planner.ask(text, signal);
    this.hearing = hears;
    try {
      return await this.loop(way, text, signal);
    } catch (error) {
      return isAbort(error) ? { say: "" } : this.failure(error);
    } finally {
      this.hearing = NO_HEARS;
    }
  }

  policy(task: string): TaskPolicy | null {
    return task === this.talk.id ? this.allowedPolicy : null;
  }

  before(task: string, call: Call): Undo | null {
    return task === this.talk.id && this.running ? this.running.before(call) : null;
  }

  after(task: string, ok: boolean): void {
    if (task === this.talk.id) this.running?.after(ok);
  }
}

/** What Dashi adds after the model's own words: that it is done when the model said nothing, and the offer to undo. */
function lastWords(run: Running, said: string): string {
  const changed = run.steps.some((step) => step.undo && step.ok);
  const did = run.steps.length > 0 && said.trim() === "" ? (run.steps.every((step) => step.ok !== false) ? "Done." : "That didn't work.") : "";
  return [did, changed ? "Say undo that to put it back." : ""].filter(Boolean).join(" ");
}

export function startAssistant(options: AssistantOptions): Assistant {
  const core = new Core(options);
  return {
    talk: core.talk,
    prepare: () => core.prepare(),
    ask: (words, signal, hears) => core.ask(words, signal, hears),
    policy: (task) => core.policy(task),
    before: (task, call) => core.before(task, call),
    after: (task, _undo, ok) => core.after(task, ok),
    close: () => core.talk.end("stopped"),
  };
}
