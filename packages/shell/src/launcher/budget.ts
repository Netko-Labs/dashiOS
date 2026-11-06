/**
 * The launcher's time budgets (docs/betterments.html, Speed): what each kind
 * of source may spend on a keystroke, and what happens when it is late.
 *
 * | Source                                  | Budget            | Late answers                                    |
 * | --------------------------------------- | ----------------- | ----------------------------------------------- |
 * | apps, windows, settings, menus, actions | 2 ms, all of them | never late: in memory, worked out at once       |
 * | files (one LocalSearch connection)      | 80 ms             | fill the slots held for them                    |
 * | applets, scripts, D-Bus providers       | 80 ms             | append below, marked slow; dropped after three |
 *
 * A slow source is dropped for the session only when it doesn't answer at all
 * (`BUDGET.giveUpMs`) three times running; one that answers late is still
 * worth its rows, and any answer it gives clears its misses.
 *
 * Pure: the clock and the timers come in, so the tests drive them. Each query
 * has a sequence number; an answer for an older one is dropped, so a slow
 * source can never put rows under the selection for what is typed now.
 */

export const BUDGET = {
  /** ❖ tapped → the first frame, with the field ready. */
  openMs: 50,
  /** A keystroke → its rows drawn: one frame. */
  keystrokeMs: 16,
  /** Every in-memory source together, per keystroke. */
  instantMs: 2,
  /** Files, then their answer goes into the slots held for it. */
  filesMs: 80,
  /** A slow source, then it is marked slow and its answer appended. */
  slowMs: 80,
  /** No answer this long after it was asked counts as a miss (a late answer doesn't). */
  giveUpMs: 2000,
  /** This many misses running and a slow source isn't asked again this session. */
  misses: 3,
} as const;

export interface Timers {
  now(): number;
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  now: () => performance.now(),
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** How long `work` took, and whether that was over `budgetMs`. */
export function timed<T>(work: () => T, budgetMs: number, now: () => number = realTimers.now): { value: T; ms: number; isOver: boolean } {
  const started = now();
  const value = work();
  const ms = now() - started;
  return { value, ms, isOver: ms > budgetMs };
}

/** What became of an ask that a newer one replaced before it ran. */
export const SUPERSEDED: unique symbol = Symbol("superseded");

/**
 * One ask in flight at a time: an ask made while one runs waits for it and
 * takes the place of any ask already waiting, which resolves `SUPERSEDED`
 * without running. Typing "terminal" asks LocalSearch for "te", then for
 * "terminal", and never for what was typed in between.
 */
export class LatestOnly<Query, Answer> {
  private running = false;
  private waiting: { query: Query; resolve: (answer: Answer | typeof SUPERSEDED) => void; reject: (error: unknown) => void } | null = null;

  constructor(private readonly run: (query: Query) => Promise<Answer>) {}

  ask(query: Query): Promise<Answer | typeof SUPERSEDED> {
    return new Promise((resolve, reject) => {
      this.waiting?.resolve(SUPERSEDED);
      this.waiting = { query, resolve, reject };
      this.next();
    });
  }

  private next(): void {
    if (this.running || !this.waiting) return;
    const { query, resolve, reject } = this.waiting;
    this.waiting = null;
    this.running = true;
    this.run(query)
      .then(resolve, reject)
      .finally(() => {
        this.running = false;
        this.next();
      });
  }
}

/** A source outside the shell (an applet, a script): asked per query, against `BUDGET.slowMs`. */
export interface SlowSource<Row> {
  id: string;
  /** Its name in the list ("Weather"), and in "Weather · slow". */
  label: string;
  ask(query: string): Promise<readonly Row[]>;
}

export type SlowState<Row> =
  /** Asked, inside its budget: its place is held. */
  | { kind: "waiting" }
  /** Past its budget with no answer: "Weather · slow". */
  | { kind: "slow" }
  | { kind: "answered"; rows: readonly Row[]; isLate: boolean }
  | { kind: "failed" };

export interface SlowSnapshot<Row> {
  seq: number;
  query: string;
  /** Each asked source, on-time answers first in the sources' order, then late ones as they came. */
  sources: ReadonlyArray<{ id: string; label: string; state: SlowState<Row> }>;
}

/**
 * The slow sources for each query: each is asked, given `BUDGET.slowMs`, and
 * marked slow when it overruns; its answer still comes in, below the ones that
 * were on time. A source that doesn't answer at all within `BUDGET.giveUpMs`,
 * `BUDGET.misses` times running, is dropped for the session. `onChange` hears every change for the current query only.
 */
export class SlowSources<Row> {
  private seq = 0;
  private query = "";
  private readonly misses = new Map<string, number>();
  private states = new Map<string, SlowState<Row>>();
  /** Late answers in the order they came. */
  private lateOrder: string[] = [];
  private deadline: unknown = null;

  constructor(
    private readonly sources: readonly SlowSource<Row>[],
    private readonly onChange: (snapshot: SlowSnapshot<Row>) => void,
    private readonly timers: Timers = realTimers,
  ) {}

  /** Whether `id` was late too often and is no longer asked. */
  isDropped(id: string): boolean {
    return (this.misses.get(id) ?? 0) >= BUDGET.misses;
  }

  /** Ask every source still in for `query`; the query's sequence number. */
  start(query: string): number {
    const seq = ++this.seq;
    this.query = query;
    if (this.deadline !== null) this.timers.clear(this.deadline);
    this.deadline = null;
    this.lateOrder = [];
    const asked = this.sources.filter((source) => !this.isDropped(source.id));
    this.states = new Map(asked.map((source) => [source.id, { kind: "waiting" }]));
    if (asked.length === 0) return seq;
    this.deadline = this.timers.set(() => this.overrun(seq), BUDGET.slowMs);
    for (const source of asked) {
      // Not answered at all within giveUpMs: a miss. Any answer, even for an older query, clears them.
      let settled = false;
      const giveUp = this.timers.set(() => {
        if (!settled) this.misses.set(source.id, (this.misses.get(source.id) ?? 0) + 1);
      }, BUDGET.giveUpMs);
      // A source that throws instead of rejecting has failed the same way.
      new Promise<readonly Row[]>((resolve) => resolve(source.ask(query))).then(
        (rows) => {
          settled = true;
          this.timers.clear(giveUp);
          this.misses.delete(source.id);
          this.settle(seq, source.id, { kind: "answered", rows, isLate: this.states.get(source.id)?.kind === "slow" });
        },
        () => {
          settled = true;
          this.timers.clear(giveUp);
          this.settle(seq, source.id, { kind: "failed" });
        },
      );
    }
    this.emit();
    return seq;
  }

  /** Stop listening (the launcher closed): late answers go nowhere. */
  stop(): void {
    this.seq += 1;
    if (this.deadline !== null) this.timers.clear(this.deadline);
    this.deadline = null;
  }

  snapshot(): SlowSnapshot<Row> {
    const entry = (source: SlowSource<Row>) => ({ id: source.id, label: source.label, state: this.states.get(source.id) as SlowState<Row> });
    const asked = this.sources.filter((source) => this.states.has(source.id));
    const onTime = asked.filter((source) => !this.lateOrder.includes(source.id)).map(entry);
    const late = this.lateOrder.flatMap((id) => asked.filter((source) => source.id === id).map(entry));
    return { seq: this.seq, query: this.query, sources: [...onTime, ...late] };
  }

  private overrun(seq: number): void {
    if (seq !== this.seq) return;
    this.deadline = null;
    for (const [id, state] of this.states) {
      if (state.kind !== "waiting") continue;
      this.states.set(id, { kind: "slow" });
    }
    this.emit();
  }

  private settle(seq: number, id: string, state: SlowState<Row>): void {
    if (seq !== this.seq) return;
    if (state.kind === "answered" && state.isLate) this.lateOrder.push(id);
    this.states.set(id, state);
    this.emit();
  }

  private emit(): void {
    this.onChange(this.snapshot());
  }
}
