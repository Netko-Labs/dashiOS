/**
 * One connection's side of secrets: its approvals of logins, whether it is
 * confined (in Dashi's sandbox, or on another machine), and the order its
 * calls run in. A sign-in runs alone, so the agent's own clicks can't move
 * the focus while Dashi types; a hand-over pauses every other call until the
 * person presses Done, and blanks that window in agents' pictures meanwhile.
 */

import type { SecretsRun } from "../context.ts";
import type { AgentUi, Who } from "../presence.ts";
import type { Call } from "../tools/index.ts";
import type { Approval } from "./broker.ts";

/** What every connection shares. */
export interface SecretsShared {
  sources: SecretsRun["sources"];
  atspi: SecretsRun["atspi"];
  /** Windows handed to the person now (the mask blanks them). */
  handedOver: Set<number>;
}

const exclusive = (call: Call) => call.name === "sign_in" || call.name === "fill_code";

export class SessionSecrets {
  readonly approvals = new Map<string, Approval>();
  private paused: Promise<void> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly shared: SecretsShared,
    private readonly ui: Pick<AgentUi, "signIn" | "turn">,
    readonly confined: boolean,
  ) {}

  /** Run `work` for `call` once nothing it must wait for is going on. */
  async around<T>(call: Call, work: () => Promise<T>): Promise<T> {
    while (call.name !== "hand_over" && this.paused) await this.paused;
    while (this.running) await this.running;
    if (!exclusive(call)) return work();
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

  /** The secrets part of a call's RunContext. */
  run(agent: number, who: () => Who): SecretsRun {
    return {
      confined: this.confined,
      approvals: this.approvals,
      sources: this.shared.sources,
      atspi: this.shared.atspi,
      ask: (summary, logins) => this.ui.signIn({ agent, who: who(), summary, logins }),
      handOver: async (window, reason) => {
        this.shared.handedOver.add(window);
        let resume = () => {};
        this.paused = new Promise((resolve) => {
          resume = resolve;
        });
        try {
          return await this.ui.turn({ agent, who: who(), reason });
        } finally {
          this.shared.handedOver.delete(window);
          this.paused = null;
          resume();
        }
      },
    };
  }
}
