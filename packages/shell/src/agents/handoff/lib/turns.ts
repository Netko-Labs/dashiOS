/**
 * A run's turns: starting one as a user service (runner.ts), reading its
 * stream into the store, and, when the person adds words, stopping a turn
 * that is working so the next one resumes with them (follow-up.ts).
 */

import { join } from "node:path";
import { ANSWERERS, findHarness, HARNESSES, type HarnessId, harnessEnv } from "../../ask/index.ts";
import { taskSocket } from "../../sandbox.ts";
import type { HandoffDeps } from "../types.ts";
import { TASK_PROMPT, taskCommand } from "./commands.ts";
import { followUpPrompt, followUpRoute } from "./follow-up.ts";
import type { RunKeeper } from "./keeper.ts";
import { plainFailure } from "./quiet.ts";
import type { QuietWatch } from "./quiet-watch.ts";
import { eventsOf } from "./stream.ts";

export class Turns {
  /** The turn being read for each run, and how to stop reading it. */
  private readonly watching = new Map<string, { turn: number; off: () => void }>();
  /** Words waiting for a run that has no session yet, or for its turn to end before it resumes. */
  private readonly waitingWords = new Map<string, string[]>();

  constructor(
    private readonly deps: HandoffDeps,
    private readonly keeper: RunKeeper,
    private readonly quiet: QuietWatch,
  ) {}

  /** Read turn `turn` of `run` into the store. */
  watch(run: string, harness: HarnessId, turn: number): void {
    const { runs, runner } = this.deps;
    this.watching.get(run)?.off();
    const off = runner.watch(
      run,
      turn,
      (line) => {
        const events = eventsOf(harness, line);
        if (events.length > 0) this.quiet.heard(run);
        const name = ANSWERERS[harness].name;
        for (const event of events) runs.event(run, event.kind === "failed" ? { ...event, error: plainFailure(name, event.error) } : event);
        // Words that waited for its session go now.
        if (runs.get(run)?.session && this.waitingWords.has(run) && this.watching.get(run)?.turn === turn) this.flushWords(run);
      },
      (code) => {
        if (this.watching.get(run)?.turn !== turn) return;
        this.watching.delete(run);
        this.quiet.heard(run);
        if (this.waitingWords.has(run)) return void this.resume(run, true);
        // Ended badly without a word on its stream: what it wrote to its errors, in plain words when they are known ones.
        const errors = code !== 0 && runs.get(run)?.error === null ? (runner.readErrors?.(run, turn) ?? "") : "";
        const plain = errors ? plainFailure(ANSWERERS[harness].name, errors) : "";
        if (plain && plain !== errors && !runs.get(run)?.ended) runs.event(run, { kind: "failed", error: plain });
        runs.exited(run, code);
      },
    );
    this.watching.set(run, { turn, off });
  }

  /** Start turn `turn` of a run with this prompt, resuming `session` if there is one. */
  async start(run: string, harness: HarnessId, turn: number, prompt: string, session: string | null): Promise<boolean> {
    const { runs, runner, home, runtime, env, files, shell } = this.deps;
    const spec = HARNESSES[harness];
    const where = home ? findHarness(spec, home, env.PATH, files) : null;
    if (!where || !runtime) {
      runs.event(run, { kind: "failed", error: `${ANSWERERS[harness].name} isn't installed.` });
      return false;
    }
    // The bridge connects again when the shell restarts (bin/dashi-mcp.ts), through the socket folder the sandbox binds.
    const command = taskCommand(harness, { prompt, system: TASK_PROMPT, session, mcp: { command: shell.bun, args: [shell.bridge, "--reconnect"], env: {} } });
    const profile = {
      socket: taskSocket(runtime),
      readOnly: [...where.readOnly, ...[shell.bun, shell.bridge].filter((path) => path.startsWith(`${home}/`))],
      state: spec.state(home, env),
      cwd: join(runtime, "dashi-task"),
      task: true,
    };
    const error = await runner.start({
      run,
      turn,
      argv: [shell.bun, shell.dashiAgent, "--name", `task-${run}`, "--", where.program, ...command.args],
      stdin: command.stdin,
      env: harnessEnv(spec, env, { ...command.env, DASHI_AGENT_PLAN: JSON.stringify(profile) }),
    });
    if (error) {
      runs.event(run, { kind: "failed", error });
      return false;
    }
    this.keeper.track(run);
    this.keeper.save();
    this.watch(run, harness, turn);
    this.quiet.wait(run, harness, turn);
    return true;
  }

  /** Send words to a run (⇥ on its row, Follow up): false when there's no such run. */
  tell(run: string, text: string): boolean {
    const view = this.deps.runs.get(run);
    const words = text.trim();
    if (!view || !words) return false;
    this.waitingWords.set(run, [...(this.waitingWords.get(run) ?? []), words]);
    const route = followUpRoute(view, words);
    if (route.kind === "restart") this.deps.runner.stop(run, view.turn);
    else if (route.kind !== "wait") void this.resume(run, false);
    return true;
  }

  stop(run: string): void {
    const { runs, runner } = this.deps;
    const view = runs.get(run);
    if (!view) return;
    this.quiet.heard(run);
    this.waitingWords.delete(run);
    this.keeper.stopped(run, view.turn);
    runs.stopping(run);
    runner.stop(run, view.turn);
  }

  close(): void {
    for (const { off } of this.watching.values()) off();
    this.watching.clear();
  }

  /** The words waiting for `run` go into its session: stopped where it is first if it still works. */
  private flushWords(run: string): void {
    const view = this.deps.runs.get(run);
    if (!view) return;
    const route = followUpRoute(view, "");
    if (route.kind === "restart") {
      // It stops, and the words go once its turn has ended (watch's exit).
      this.deps.runner.stop(run, view.turn);
      return;
    }
    if (route.kind !== "wait") void this.resume(run, false);
  }

  /** Its next turn, with the words that waited. */
  private async resume(run: string, interrupted: boolean): Promise<void> {
    const { runs } = this.deps;
    const words = this.waitingWords.get(run) ?? [];
    this.waitingWords.delete(run);
    const before = runs.get(run);
    if (!before || words.length === 0) return;
    const text = words.join("\n\n");
    const route = followUpRoute({ ...before, phase: "done" }, text);
    const view = runs.followUp(run, text);
    if (!view) return;
    const prompt = route.kind === "start-over" ? route.prompt : followUpPrompt(text, interrupted);
    await this.start(run, view.harness, view.turn, prompt, route.kind === "resume" ? route.session : null);
  }
}
