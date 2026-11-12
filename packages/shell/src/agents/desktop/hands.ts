/**
 * The agents' hands: input on the compositor's agent seat (IPC `agent-input`,
 * comp/src/agent_seat/). The seat is the mechanism; what the person may
 * expect is decided here:
 *
 *  - The person wins. When they click or type in a window (the compositor's
 *    `person-input` events), input to that window waits until they have left
 *    it alone for QUIET_MS; the call is told "the person is using this window".
 *  - Apps that listen only to the person's seat (Metal apps today, and
 *    probably Chromium's family) can't hear the agent seat. For those, one
 *    action borrows the person's seat, and the compositor refuses unless the
 *    person's own input is QUIET_MS old (a page keeping the screen awake,
 *    and the agent's own actions, don't count: session/idle.rs); the call
 *    waits up to WAIT_MS for a pause ("Waiting for you to pause" in the menu
 *    bar), then gives up, saying how long to wait.
 *  - A drag there holds the person's button down across several requests. Its
 *    press waits for a pause like any action; once it is down, a step the
 *    compositor refuses is not waited out (`"once"`): the person is back, the
 *    compositor has already let go for them, and the drag ends there.
 */

import type { Compositor, Params } from "../../compositor/index.ts";
import { KEYMAP } from "../../keymap/keymap.ts";

/** The person must have left a window (or the desktop, when borrowing) alone this long. */
export const QUIET_MS = 2000;
/** How long a borrowing action waits for the person to pause. */
export const WAIT_MS = 6000;
const POLL_MS = 250;

/** App ids of clients known (Metal) or expected (Chromium, Firefox: unverified) to read only the first seat. */
export const SINGLE_SEAT_APPS: readonly string[] = [
  ...(KEYMAP.apps.metal ?? []),
  "helium*",
  "chromium*",
  "google-chrome*",
  "brave*",
  "microsoft-edge*",
  "firefox*",
  "org.mozilla.firefox*",
  "code",
  "Code",
  "electron*",
];

/** An app id pattern: exact, or a prefix ending in `*`. */
const matches = (pattern: string, appId: string) => (pattern.endsWith("*") ? appId.startsWith(pattern.slice(0, -1)) : appId === pattern);

/** Whether this app can't hear the agent's seat, so an action borrows the person's. */
export const readsOnePersonSeat = (appId: string): boolean => SINGLE_SEAT_APPS.some((pattern) => matches(pattern, appId));

/**
 * Whether an action into this window borrows the person's seat. X11 apps do
 * too: X has one keyboard and one pointer, and Xwayland follows the person's.
 */
export const borrowsPersonSeat = (window: { appId: string; x11?: boolean }): boolean => window.x11 === true || readsOnePersonSeat(window.appId);

/** The person is at work where the agent wanted to act. */
export class PersonBusy extends Error {
  constructor(
    readonly window: number,
    /** The person's seat was borrowed, so it is the whole desktop that was busy. */
    readonly desktop: boolean,
    /** How long until the agent may act, if the person stops now. */
    readonly waitMs: number = QUIET_MS,
  ) {
    super(desktop ? "the person is using the desktop" : `the person is using w${window}`);
  }
}

/** The compositor's refusal to borrow the person's seat while they are active. */
const isBusyAnswer = (error: unknown): error is Error => error instanceof Error && error.message.startsWith("the person is using the desktop");

/** The wait the compositor's refusal names ("… (free in 1200 ms)"), else a whole QUIET_MS. */
export function busyWait(message: string): number {
  const ms = Number(/\(free in (\d+) ms\)/.exec(message)?.[1]);
  return Number.isFinite(ms) ? Math.min(ms, QUIET_MS) : QUIET_MS;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/** Whether a borrowing action waits for the person to pause (up to WAIT_MS), or is tried once. */
export type Patience = "waits" | "once";

/** What a tool sends: a pointer action or keys; `window` and the cursor's name are added here. */
export type Payload = Omit<Params<"agent-input">, "window" | "label" | "borrow" | "release">;

export class Hands {
  /** When the person last used each window (null: the desktop). */
  private readonly lastInput = new Map<number | null, number>();
  private readonly stop: () => void;

  constructor(
    private readonly compositor: Pick<Compositor, "agentInput" | "on">,
    private readonly clock: Clock = realClock,
  ) {
    this.stop = compositor.on((event) => {
      if (event.event === "person-input") this.lastInput.set(event.window, this.clock.now());
    });
  }

  close(): void {
    this.stop();
  }

  /** Milliseconds until the person's last input to `window` is QUIET_MS old; 0 when it already is. */
  busyFor(window: number): number {
    const last = this.lastInput.get(window);
    return last === undefined ? 0 : Math.max(0, QUIET_MS - (this.clock.now() - last));
  }

  /**
   * One request of input into `window`. Rejects with `PersonBusy` when the
   * person is using it (or, borrowing, the desktop, for longer than WAIT_MS;
   * at once with `"once"`, a step of a drag already under way), or with the
   * compositor's own words when it refuses.
   */
  async send(
    window: { id: number; appId: string; x11?: boolean },
    payload: Payload,
    agent: string,
    say: (text: string) => void,
    patience: Patience = "waits",
  ): Promise<void> {
    const borrow = borrowsPersonSeat(window);
    const give = this.clock.now() + WAIT_MS;
    const request = { window: window.id, label: agent, ...payload, ...(borrow ? { borrow: { idleMs: QUIET_MS } } : {}) };
    for (;;) {
      const busy = borrow ? 0 : this.busyFor(window.id);
      if (busy > 0) throw new PersonBusy(window.id, false, busy);
      try {
        await this.compositor.agentInput(request);
        return;
      } catch (error) {
        if (!isBusyAnswer(error)) throw error;
        if (patience === "once" || this.clock.now() >= give) throw new PersonBusy(window.id, true, busyWait(error.message));
        say("Waiting for you to pause");
        await this.clock.sleep(POLL_MS);
      }
    }
  }

  /** Wait `ms` on the hands' clock: the gap between a drag's steps. */
  pause(ms: number): Promise<void> {
    return this.clock.sleep(ms);
  }

  /** Let go of everything the agent holds and hide its cursor (the stop key, an agent leaving). */
  async release(): Promise<void> {
    try {
      await this.compositor.agentInput({ release: true });
    } catch {
      // Locked, or the compositor is gone: nothing is held that matters.
    }
  }
}
