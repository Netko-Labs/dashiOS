/**
 * One question of a launcher run, asked in two places: on the run's card in
 * the panel, and, whenever the panel is closed, in the sheet (route.ts says
 * which shows when). The first answer, in either place, settles it and the
 * other comes down. A panel choice that asks again ("Other login…") puts up
 * a fresh question on the card.
 */

import type { RunQuestion, RunView } from "../run-view.ts";
import type { AgentRuns } from "../store.ts";
import { QuestionRoute, type RouteStep } from "./route.ts";

/** What the question needs of the launcher's runs and its panel. */
export interface PanelDeps {
  runs: AgentRuns;
  /** Whether the panel is on screen now. */
  panelOpen(): boolean;
  /** Told each time the panel opens (true) or closes (false). */
  onPanel(listener: (open: boolean) => void): () => void;
  /** A question went up while the panel was closed: the notification. */
  attention(run: RunView, question: RunQuestion): void;
}

export type Asked = Omit<RunQuestion, "id">;

export interface TwoPlacesOptions<T> {
  /** The sheet for it; its signal aborts when the sheet comes down unanswered. */
  sheet(signal: AbortSignal): Promise<T>;
  /** A panel choice as the answer ("again": ask again, with `again`). */
  fromPanel(choice: string): T | "again";
  /** The answer when it was taken back (the run ended, the agent left). */
  refused: T;
  signal: AbortSignal | undefined;
  again?: () => Asked;
}

type Raised = { question: RunQuestion; answer: Promise<string | null> };

export class TwoPlaces<T> {
  private readonly route = new QuestionRoute();
  private current: Raised;
  private shown: AbortController | null = null;
  private finish: (value: T) => void = () => {};
  private readonly result: Promise<T>;
  private readonly offPanel: () => void;

  constructor(
    private readonly deps: PanelDeps,
    private readonly task: string,
    private readonly asked: Asked,
    private readonly options: TwoPlacesOptions<T>,
  ) {
    this.current = deps.runs.ask(task, asked);
    this.result = new Promise<T>((resolve) => {
      this.finish = resolve;
    });
    this.offPanel = deps.onPanel((open) => {
      if (open) return this.apply(this.route.panelOpened());
      // Closed by an answer pressed in it: that answer is on its way, so no sheet.
      if (deps.runs.isWaiting(task, this.current.question.id)) this.apply(this.route.panelClosed());
    });
  }

  /** Ask it; the first answer. */
  ask(): Promise<T> {
    const { signal } = this.options;
    signal?.addEventListener("abort", this.onAbort, { once: true });
    this.listen(this.current);
    if (signal?.aborted) this.onAbort();
    else this.apply(this.route.start(this.deps.panelOpen()));
    return this.result;
  }

  private readonly onAbort = (): void => this.settle("gone", this.options.refused);

  private apply(step: RouteStep): void {
    if (step.sheet === "hide" && this.shown) {
      // Taken down, its answer (a "Don't Allow" from the queue) doesn't count.
      this.shown.abort();
      this.shown = null;
    }
    if (step.sheet === "show") this.showSheet();
    if (step.notify) {
      const run = this.deps.runs.get(this.task);
      if (run) this.deps.attention(run, this.current.question);
    }
  }

  private showSheet(): void {
    const controller = new AbortController();
    this.shown = controller;
    void this.options.sheet(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        this.settle("sheet", value);
      },
      () => {},
    );
  }

  private settle(by: "panel" | "sheet" | "gone", value: T): void {
    const { counts, step } = this.route.settle(by);
    if (!counts) return;
    this.apply(step);
    this.offPanel();
    this.options.signal?.removeEventListener("abort", this.onAbort);
    // The card goes whichever place answered (a no-op when the panel did).
    this.deps.runs.answer(this.task, this.current.question.id, null);
    this.finish(value);
  }

  private listen(question: Raised): void {
    void question.answer.then((choice) => {
      if (question !== this.current) return;
      if (choice === null) return this.settle("gone", this.options.refused);
      const value = this.options.fromPanel(choice);
      if (value !== "again") return this.settle("panel", value);
      this.current = this.deps.runs.ask(this.task, this.options.again?.() ?? this.asked);
      this.listen(this.current);
    });
  }
}
