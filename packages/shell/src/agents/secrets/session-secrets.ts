/**
 * One connection's side of secrets: its approvals of logins, whether it is
 * confined (in Dashi's sandbox, or on another machine), and the order its
 * calls run in. A sign-in runs alone, so the agent's own clicks can't move
 * the focus while Dashi types; a hand-over pauses every other call until the
 * person presses Done, and blanks that window in agents' pictures meanwhile.
 */

import type { Placed, Rect } from "../atspi/tree.ts";
import type { SecretsRun } from "../context.ts";
import type { AgentUi, Who } from "../presence.ts";
import type { Call } from "../tools/index.ts";
import type { Approval } from "./broker.ts";

/** What every connection shares. */
export interface SecretsShared {
  sources: SecretsRun["sources"];
  atspi: SecretsRun["atspi"];
  /** Fields Dashi typed secrets into, by window, until when (the mask blanks them). */
  filled: Map<number, FilledField[]>;
  vault: SecretsRun["vault"];
  /** Windows handed to the person now (the mask blanks them). */
  handedOver: Set<number>;
  /** Dashi typed a secret into a window: what its app shows next is blanked a while (fill-prompts.ts). */
  touched?(window: number): void;
}

/** A field Dashi typed a secret into, in its window's content coordinates when typed, and how to find it again. */
export interface FilledField {
  rect: Rect;
  until: number;
  again?: Placed["again"];
}

/** How long a field Dashi filled stays blank in agents' pictures, at most (less once its page is gone). */
export const FILLED_MS = 10 * 60_000;

export class SessionSecrets {
  readonly approvals = new Map<string, Approval>();
  private paused: Promise<void> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly shared: SecretsShared,
    private readonly ui: Pick<AgentUi, "signIn" | "turn">,
    readonly confined: boolean,
  ) {}

  /** Run `work` for `call` once nothing it must wait for is going on: a hand-over, or Dashi typing a secret. */
  async around<T>(call: Call, work: () => Promise<T>): Promise<T> {
    while (call.name !== "hand_over" && this.paused) await this.paused;
    while (this.running) await this.running;
    return work();
  }

  /**
   * Run `work` alone: while Dashi checks a field and types a secret, this
   * agent's other calls wait, so its own clicks can't move the focus. Only
   * the typing is held, not the sheet before it: a screenshot needn't wait for the person.
   */
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    while (this.running) await this.running;
    let done = () => {};
    this.running = new Promise((resolve) => {
      done = resolve;
    });
    try {
      return await work();
    } finally {
      this.running = null;
      done();
    }
  }

  /** The secrets part of a call's RunContext; `signal` aborts when the agent gives up on the call. */
  run(agent: number, who: () => Who, signal?: AbortSignal): SecretsRun {
    return {
      confined: this.confined,
      approvals: this.approvals,
      sources: this.shared.sources,
      atspi: this.shared.atspi,
      vault: this.shared.vault,
      exclusive: (work) => this.exclusive(work),
      filled: (window, rect, again) => {
        if (!rect) return;
        const now = Date.now();
        const kept = (this.shared.filled.get(window) ?? []).filter((f) => f.until > now);
        this.shared.filled.set(window, [...kept, { rect, until: now + FILLED_MS, again }].slice(-16));
        this.shared.touched?.(window);
      },
      ask: (summary, logins) => this.ui.signIn({ agent, who: who(), summary, logins }, signal),
      handOver: async (window, reason) => {
        this.shared.handedOver.add(window);
        let resume = () => {};
        this.paused = new Promise((resolve) => {
          resume = resolve;
        });
        try {
          return await this.ui.turn({ agent, who: who(), reason }, signal);
        } finally {
          this.shared.handedOver.delete(window);
          this.paused = null;
          resume();
        }
      },
    };
  }
}
