/** What the capsule piece is given and what it shows (docs/night-0.9-contract.md, "capsule"). */

import type { DictationState, PillAsk, VoiceModeState } from "../shared/pill/index.ts";

/** A long answer, read whole in the card (it is not an ask: nothing waits on it). */
export interface Reading {
  id: string;
  /** The task it answers, in the person's words. */
  request: string;
  text: string;
}

/** The card that is open: an ask, or an answer to read; whether it has the keyboard; when its buttons arm. */
export interface OpenCard {
  what: { ask: PillAsk } | { reading: Reading };
  keyboard: boolean;
  armsAt: number;
  /** How far "Read it all" has scrolled it: the first of its lines that shows (0 at the start). */
  from: number;
  /** Dashi listens for a spoken yes or no, or the answer. */
  hears: boolean;
}

/** The one thing the surface draws. */
export type Shown =
  | { kind: "none" }
  | { kind: "dictation"; state: Exclude<DictationState, { phase: "idle" }> }
  | { kind: "voice"; state: Exclude<VoiceModeState, { phase: "idle" }> }
  | { kind: "card"; card: OpenCard; listening: Extract<VoiceModeState, { phase: "listening" }> | null };

/** Which seat the capsule takes (pill-v2 README, "Where it sits"). */
export type Seat = "home" | "left" | "right" | "up" | "edge" | "edge-up";

export interface Place {
  seat: Seat;
  /** From the screen's bottom edge to the capsule's. */
  bottom: number;
  /** Centred, or this far from the screen's left or right edge. */
  at: { centre: true } | { left: number } | { right: number };
  maxWidth: number;
  /** The most of the words shown, in points. */
  tail: number;
}

/** An agent's question for the card (agent-sheets routes `ask_person` here). */
export interface CardQuestion {
  /** Who asks, in words. */
  who: string;
  text: string;
  /** The question as it is said out loud. */
  spoken: string;
  /** How long it waits, in seconds. */
  seconds: number;
  choices?: readonly string[];
  /** The task it answers, in a few words. */
  about?: string;
}

/** The person's own words and how they gave them, or why there are none (agents/presence.ts `PersonAnswer`). */
export type QuestionAnswer = { text: string; by: "voice" | "typing" } | { none: "declined" | "no-answer" };
