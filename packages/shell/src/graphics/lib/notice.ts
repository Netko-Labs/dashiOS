/**
 * What Dashi says when the graphics mode changes (docs/design.html PA-16),
 * pure so it can be tested. A change Dashi made on its own (Automatic, on a
 * cable or a screen on the card's port) is said once, in one notification,
 * after the new mode has held for `NOTICE_SETTLE_MS` and at most once every
 * `NOTICE_QUIET_MS`, so a loose cable says nothing, or one thing at the end.
 * A switch that waited for apps to quit is said at once, in place of the
 * waiting notice. A change the person just made (the tile, Settings, Use
 * Hybrid) says nothing: the tile already shows it. Nothing is said on a
 * one-GPU machine, at login, or when the switch failed.
 *
 * The controller (controller.ts) keeps the times and the mode last told and
 * asks again when this says "later"; laptop/start.ts posts the notice in the
 * one place graphics notices have, so a new one replaces the last.
 */

import { paneTitle } from "../../shared/settings/panes.ts";
import { type GraphicsMode, listNames } from "../policy.ts";

/** How long a new mode holds before it is said: a second past the refresh rate's own wait (display-config/auto-refresh.ts, 5 s), so a notice can name both. */
export const NOTICE_SETTLE_MS = 6000;
/** At most one graphics notice this often; a later change waits, and is said then if it still stands. */
export const NOTICE_QUIET_MS = 30_000;

/**
 * Why the mode changed: the cable (`unplugged`, `plugged`), a screen on the
 * card's own port coming or going, the apps it waited for having quit, the
 * person's own pick, or a switch that failed.
 */
export type GraphicsWhy = "unplugged" | "plugged" | "screen" | "screen-gone" | "waited" | "chosen" | "failed";

export interface GraphicsChange {
  /** A graphics card cardwire can switch (two GPUs). */
  card: boolean;
  /** The mode last said, or the one Dashi started in; null before that is known (login). */
  before: GraphicsMode | null;
  /** The mode in place now. */
  after: GraphicsMode | null;
  why: GraphicsWhy;
  /** How long `after` has been in place, ms. */
  held: number;
  /** Since the last graphics notice, ms; null when there was none. */
  sinceNotice: number | null;
  /** The "waiting for apps" notice is up. */
  waiting: boolean;
  /** The apps it waited for ("waited"). */
  waitedFor?: readonly string[];
  /** The built-in screen's rate, when Automatic moved it with the cable ("60 Hz"). */
  rate?: string | null;
}

export type GraphicsNoticeAction = { key: "use-hybrid"; label: string } | { key: "settings"; label: string };

export interface GraphicsNotice {
  summary: string;
  body: string;
  actions: GraphicsNoticeAction[];
}

export type NoticeDecision =
  /** Nothing to say; `withdraw` takes the waiting notice down (the wait ended without a switch). */
  | { say: "nothing"; withdraw: boolean }
  /** Ask again in `ms`. */
  | { say: "later"; ms: number }
  | { say: "notice"; notice: GraphicsNotice };

const AUTOMATIC: ReadonlySet<GraphicsWhy> = new Set(["unplugged", "plugged", "screen", "screen-gone"]);

export function decideNotice(change: GraphicsChange): NoticeDecision {
  if (!change.card || change.why === "failed" || change.after === null) return { say: "nothing", withdraw: false };
  // The person's own pick: the tile shows it, and a wait it ended is over.
  if (change.why === "chosen") return { say: "nothing", withdraw: change.waiting };
  // Login: the mode Dashi starts in isn't news.
  if (change.before === null) return { say: "nothing", withdraw: false };
  // Back where it was last said (the cable went out and in): nothing changed for the person.
  if (change.before === change.after) return { say: "nothing", withdraw: change.waiting };
  if (AUTOMATIC.has(change.why)) {
    const wait = Math.max(NOTICE_SETTLE_MS - change.held, change.sinceNotice === null ? 0 : NOTICE_QUIET_MS - change.sinceNotice);
    if (wait > 0) return { say: "later", ms: wait };
  }
  return { say: "notice", notice: noticeFor(change.after, change) };
}

const SAVE = "to save battery";

function noticeFor(after: GraphicsMode, change: GraphicsChange): GraphicsNotice {
  if (after === "integrated") {
    return { summary: "Using the built-in graphics", body: integratedBody(change), actions: [{ key: "use-hybrid", label: "Use Hybrid" }] };
  }
  const settings: GraphicsNoticeAction = { key: "settings", label: `${paneTitle("graphics")} Settings…` };
  const summary = after === "hybrid" ? "The graphics card is on" : "The graphics card is on for the apps you chose";
  return { summary, body: cardOnBody(change), actions: [settings] };
}

function integratedBody(change: GraphicsChange): string {
  switch (change.why) {
    case "unplugged":
      return change.rate
        ? `Unplugged, so the graphics card sleeps and the screen runs at ${change.rate} ${SAVE}.`
        : `Unplugged, so the graphics card sleeps ${SAVE}.`;
    case "screen-gone":
      return `The screen on the graphics card was unplugged, so the card sleeps ${SAVE}.`;
    case "waited": {
      const names = change.waitedFor ?? [];
      return names.length > 0 ? `${listNames(names)} quit, so the graphics card sleeps ${SAVE}.` : `The apps on the graphics card quit, so it sleeps ${SAVE}.`;
    }
    default:
      return `The graphics card sleeps ${SAVE}.`;
  }
}

function cardOnBody(change: GraphicsChange): string {
  switch (change.why) {
    case "plugged":
      return change.rate
        ? `Plugged in, so apps can use the graphics card again, and the screen is back to ${change.rate}.`
        : "Plugged in, so apps can use the graphics card again.";
    case "screen":
      return "A screen is connected to the graphics card, so the card is on to show it.";
    default:
      return "Apps can use the graphics card again.";
  }
}
