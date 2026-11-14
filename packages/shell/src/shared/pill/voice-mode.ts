/**
 * Dashi's voice mode, as the capsule is told it (docs/night-0.9-contract.md,
 * "capsule"). 0.8's loop is underneath (voice/voice.ts, the launcher's Ask
 * tasks): the capsule piece's adapter turns what it does into one
 * `VoiceModeState` at a time, and into `asks`, the things that wait for the
 * person. The capsule draws both; the bar counts `asks`.
 */

export type VoiceModeState =
  | { phase: "idle" }
  /** v-01. The Dashi key is down, not yet a hold. */
  | { phase: "key-down" }
  /** v-02. Listening: everything heard so far. `answering` while the words will answer an ask (v-07, v-10). */
  | { phase: "listening"; text: string; answering: boolean }
  /** v-03. The key came up: what was heard, while the assistant thinks. Nothing has run yet: Cancel and "Type it instead" show here. */
  | { phase: "heard"; text: string }
  /** v-05, v-20. The assistant runs step `index` (from 0) of `of`. */
  | { phase: "step"; title: string; index: number; of: number; task: string }
  /** v-11, v-19. Dashi speaks: the sentence's words and the one being said (`at`, -1 before the first). `full` is for a screen reader and the card. */
  | { phase: "answer"; words: readonly string[]; at: number; full: string }
  /** v-12. It is done: one line, then idle at `until`. */
  | { phase: "done"; line: string; until: number }
  /** v-18. Stopped by the person. */
  | { phase: "stopped"; until: number }
  /** Something to tell: what is missing and where a press goes. */
  | { phase: "notice"; line: string; go?: "voice" | "agents" | "launcher"; until: number };

export type VoiceModePhase = VoiceModeState["phase"];

/** Something that waits for the person: shown as the card on the Dock, the oldest first, one at a time. */
export type PillAsk =
  /** v-08, v-13, b-13. A plan that waits for a yes (a launcher Ask task in phase `planned`; `task` is its id, `request` its words). `spoken` when it was asked by voice: its card opens by itself. */
  | { kind: "permission"; id: string; task: string; request: string; steps: readonly string[]; spoken: boolean; since: number }
  /** v-06, b-15. A question (`ask_person`): its words and, when it has them, its choices. `who` asks; `about` is the task it answers in a few words ("" when there is none). */
  | { kind: "question"; id: string; text: string; choices: readonly string[]; who: string; about: string; since: number };

/** What the capsule and the bar ask of the voice loop. */
export type VoiceModeCommand =
  /** Yes or no on a permission's card (a press, or Return once the card has the keyboard). A yes counts only when the compositor says the person pressed on `CAPSULE_LAYER` (`input-origin`). */
  | { do: "answer-permission"; id: string; yes: boolean }
  /** An answer to a question: a choice pressed or words typed. */
  | { do: "answer-question"; id: string; text: string }
  /** The square, the Dashi key with Esc, a press on a speaking capsule: stop hearing, thinking, speaking. `task` stops that task too. */
  | { do: "stop"; task?: string }
  /** The bar: show this ask's card now (a typed task's does not open by itself). */
  | { do: "open-ask"; id: string }
  /** Only in phase `heard`: not for Dashi after all. Stop the task and land the words as a dictation (`dictationCommands` `type`). */
  | { do: "type-instead" };

/** The card's buttons arm this long after it opens (pill-v2 README, "A real question, and a fake"). */
export const CARD_ARM_MS = 500;
/** The layer namespace of the capsule and its card: what `input-origin`, `input-region` and `layer-motion` are asked about. */
export const CAPSULE_LAYER = "dashi.capsule";
