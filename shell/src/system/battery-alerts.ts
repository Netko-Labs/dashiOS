/**
 * Low-battery warnings, posted as notifications. Each battery reading walks a
 * small state machine: a level posts once per discharge, only when two polls
 * in a row reach it (a charge that flaps across a line posts nothing), and
 * plugging in clears the warning. `decideBatteryAlert` is the pure part; the
 * `BatteryAlerts` class polls and talks to the notification store.
 */

import { type Battery, readBattery } from "./battery.ts";
import type { NotificationStore } from "../notifications/store.ts";
import { CloseReason, type NotifyInput, type Urgency } from "../notifications/types.ts";
import { INTERVALS } from "./store.ts";

export interface Level {
  /** Posts when the charge is at or below this percent. */
  percent: number;
  /** Normal banners go away and, under Do Not Disturb, wait in the center; critical ones stay until dismissed. */
  urgency: Urgency;
  summary: string;
  /** The sentence after "Your battery is at N%.". */
  advice: string;
}

/** Shallowest first: a deeper level replaces a shallower one on screen. */
export const LEVELS: readonly Level[] = [
  { percent: 20, urgency: "normal", summary: "Low Battery", advice: "Plug in soon." },
  { percent: 10, urgency: "critical", summary: "Battery Very Low", advice: "Plug in now." },
  {
    percent: 5,
    urgency: "critical",
    summary: "Battery Critically Low",
    advice: "Plug in now, or save your work: the computer may turn off.",
  },
];

/** What one poll saw. `charging` is true on a charger (charging, full, or held), as the menu bar counts it. */
export interface BatteryReading {
  percent: number;
  charging: boolean;
}

export interface AlertState {
  /** How many levels have posted this discharge (the deepest so far); 0 for none. */
  posted: number;
  /** How many levels the previous poll reached; a level posts only when this poll agrees. */
  previous: number;
}

const FRESH: AlertState = { posted: 0, previous: 0 };

export type AlertDecision = { kind: "none" } | { kind: "post"; level: Level; percent: number } | { kind: "clear" };

const NONE: AlertDecision = { kind: "none" };

/** How many levels a charge is at or below: 0 above 20%, 3 at 5% or less. */
export function levelsReached(percent: number): number {
  return LEVELS.filter((level) => percent <= level.percent).length;
}

export function readingOf(battery: Battery | null): BatteryReading | null {
  if (battery === null) return null;
  return { percent: battery.percent, charging: battery.state !== "discharging" };
}

/**
 * One poll's step. A null reading (no battery) or a charger clears the
 * warning and starts the next discharge fresh. Otherwise a level posts when
 * both this poll and the last reached it, so the shallower of the two is what
 * is confirmed. A jump past several levels posts only the deepest.
 */
export function decideBatteryAlert(
  state: AlertState,
  reading: BatteryReading | null,
): { state: AlertState; decision: AlertDecision } {
  if (reading === null || reading.charging) {
    return { state: FRESH, decision: state.posted > 0 ? { kind: "clear" } : NONE };
  }
  const reached = levelsReached(reading.percent);
  const confirmed = Math.min(state.previous, reached);
  const level = LEVELS[confirmed - 1];
  if (confirmed <= state.posted || level === undefined) {
    return { state: { posted: state.posted, previous: reached }, decision: NONE };
  }
  return {
    state: { posted: confirmed, previous: reached },
    decision: { kind: "post", level, percent: reading.percent },
  };
}

function noticeOf(level: Level, percent: number): NotifyInput {
  return {
    appName: "Battery",
    // No icon of its own: the banner shows the generic one.
    appIcon: "",
    summary: level.summary,
    body: `Your battery is at ${percent}%. ${level.advice}`,
    actions: [],
    urgency: level.urgency,
    expireTimeout: -1,
    imagePath: "",
    desktopEntry: "",
    category: "device",
    transient: false,
    resident: false,
  };
}

export class BatteryAlerts {
  private state: AlertState = FRESH;
  /** The warning on screen for this discharge, replaced as the level deepens; 0 for none. */
  private alertId = 0;
  private inFlight = false;
  private stopped = false;

  constructor(
    private readonly store: NotificationStore,
    private readonly read: () => Promise<Battery | null> = readBattery,
  ) {}

  /** Reads once and acts on it. Polls never overlap, so readings are judged in the order they were taken. */
  async poll(): Promise<void> {
    if (this.inFlight || this.stopped) return;
    this.inFlight = true;
    try {
      const reading = readingOf(await this.read());
      if (!this.stopped) this.apply(reading);
    } catch (error) {
      // A failed read is not a reading, so it neither confirms nor clears anything.
      console.error("dashi-shell: reading the battery for alerts failed:", error);
    } finally {
      this.inFlight = false;
    }
  }

  /** Polls now and then every battery interval; the returned function stops it. */
  start(every: number = INTERVALS.battery): () => void {
    void this.poll();
    const timer = setInterval(() => void this.poll(), every);
    return () => {
      this.stopped = true;
      clearInterval(timer);
    };
  }

  private apply(reading: BatteryReading | null): void {
    const { state, decision } = decideBatteryAlert(this.state, reading);
    this.state = state;
    if (decision.kind === "post") {
      this.alertId = this.store.notify(noticeOf(decision.level, decision.percent), this.alertId);
    } else if (decision.kind === "clear") {
      this.store.close(this.alertId, CloseReason.closedByApp);
      this.alertId = 0;
    }
  }
}
