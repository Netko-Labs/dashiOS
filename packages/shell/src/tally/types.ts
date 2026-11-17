/** The tally's data: what may go on air, and who holds it now. */

import type { InkName } from "@dashi/ui";

/**
 * Why an item may go on air, strongest first. Only something critical may
 * ask (money, a secret, losing work for good, a system change, speaking for
 * the person: D260); a question that is not critical waits in its card and
 * counts as running.
 */
export type OnAirReason = "asks" | "due" | "running";

/** Something that may hold the tally: a live item, a due timer, an event, Dashi asking. */
export interface OnAirItem {
  /** Stable for the item's life ("timer:tea", "event:42", "run:7"). */
  key: string;
  reason: OnAirReason;
  /** For `asks`: whether it is one of the critical five. Anything else counts as running. */
  critical?: boolean;
  /** When it entered its reason (ms): among running items the newest wins. */
  since: number;
  /** For `due`: when it is due (ms): among due items the earliest wins. */
  deadline?: number;
  /** Its words in the bar's capsule and Glance ("Tea", "Dashi asks"). */
  label: string;
  /** When its countdown reaches zero (ms): the capsule and Glance show the time left beside the label. */
  countdown?: number;
  /** The category glyph it carries wherever colour would have to. */
  glyph: string;
  /** The ink its card floods with; null for plain ink (extensions, notifications). */
  ink: InkName | null;
}

/** Who holds the tally, and what the rest of the house does. */
export interface TallyView {
  /** The key on air, or null: nothing is, and nothing on screen says "now". */
  holder: string | null;
  /** The holder's item, for the bar and Glance. */
  item: OnAirItem | null;
  /** What else is live, on standby (a hollow ring), newest first. */
  standby: readonly OnAirItem[];
  /** House lights are down: every ink but the holder's is dimmed (at most 2 minutes). */
  houseDown: boolean;
  /** The person pinned it. */
  pinned: string | null;
}

/** The cut rules' numbers (round five, #20–22). */
export const TALLY_RULES = {
  /** A holder keeps the tally at least this long, unless something critical asks. */
  holdMs: 60_000,
  /** An item that lost the tally cannot take it back this soon. */
  noRetakeMs: 10 * 60_000,
  /** House lights, and a due item's hold, last at most this long unanswered. */
  urgentMs: 2 * 60_000,
} as const;
