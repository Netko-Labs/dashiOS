/** A turn that prints nothing for too long: its card asks what is likely wrong (sign in, keep waiting, or stop). */

import { ANSWERERS, findHarness, HARNESSES, type HarnessId, signedIn, signInCommand } from "../../ask/index.ts";
import { isWorking } from "../run-view.ts";
import type { HandoffDeps } from "../types.ts";
import { QUIET_MS, quietQuestion, quietReason } from "./quiet.ts";

export class QuietWatch {
  /** Each run's turn waiting for its first event, and the timer that asks once it has waited too long. */
  private readonly silent = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly deps: HandoffDeps,
    /** Signing in means asking again once it is; the run as it is can't go on. */
    private readonly stop: (run: string) => void,
  ) {}

  /** It printed something (or ended): no question about its silence. */
  heard(run: string): void {
    clearTimeout(this.silent.get(run));
    this.silent.delete(run);
  }

  /** After `quietMs` with nothing from turn `turn`, its card says what's likely wrong. */
  wait(run: string, harness: HarnessId, turn: number): void {
    this.heard(run);
    const timer = setTimeout(() => {
      this.silent.delete(run);
      void this.ask(run, harness, turn);
    }, this.deps.options.quietMs ?? QUIET_MS);
    this.silent.set(run, timer);
  }

  close(): void {
    for (const timer of this.silent.values()) clearTimeout(timer);
    this.silent.clear();
  }

  private async ask(run: string, harness: HarnessId, turn: number): Promise<void> {
    const { runs, runner, home, env, files, options } = this.deps;
    const still = () => {
      const view = runs.get(run);
      return view !== undefined && view.turn === turn && isWorking(view) && view.question === null;
    };
    if (!still()) return;
    const spec = HARNESSES[harness];
    const where = home ? findHarness(spec, home, env.PATH, files) : null;
    const signed = where ? await signedIn(spec, where, home, env, options.probe).catch(() => null) : null;
    if (!still() || this.silent.has(run)) return;
    const name = ANSWERERS[harness].name;
    const reason = quietReason(runner.readErrors?.(run, turn) ?? "", signed);
    const { answer } = runs.ask(
      run,
      quietQuestion(name, reason, options.signIn ? signInCommand(harness) : null, Math.round((options.quietMs ?? QUIET_MS) / 1000)),
    );
    const choice = await answer;
    if (choice === "wait") return this.wait(run, harness, turn);
    if (choice !== "sign-in") return;
    options.signIn?.(harness);
    this.stop(run);
  }
}
