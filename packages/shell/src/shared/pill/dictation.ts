/**
 * Dictation, as the capsule is told it (docs/night-0.9-contract.md, "core"
 * and "capsule"). The core piece owns the engine and sets one
 * `DictationState` at a time; the capsule draws it and sends
 * `DictationCommand`s back. Each state names the frame in
 * `pill-v2/shots/` that shows it.
 */

/** One thing tidying did. A change of mind is always named in words (`from`, `to`); the others may only be counted. */
export type TidyChange =
  | { kind: "filler"; count: number }
  | { kind: "spacing"; count: number }
  | { kind: "capital"; count: number }
  | { kind: "punctuation"; count: number }
  | { kind: "change-of-mind"; from: string; to: string };

/** Why the words were not typed and wait in the capsule with Copy. */
export type WaitReason =
  /** Nothing in front takes text (d-18). */
  | "no-field"
  /** The window the key went down in is no longer in front (d-17). */
  | "left-window"
  /** The person clicked or pressed a key in the window after letting go, and the field can't be told from another (D80). */
  | "moved"
  /** The field says it is a password (d-20); only where Dashi can know. */
  | "secret"
  /** The paste was refused or failed. */
  | "failed";

/** Why nothing was heard or dictation can't run: one line, and where a press goes. */
export type DictationTrouble =
  | "no-model" // d-25
  | "no-microphone" // d-26
  | "voice-gone" // d-27
  | "nothing-said" // d-28
  | "limit" // d-23: a hold or hands-free reached its time limit
  | "sound" // d-32: hands-free ended because this computer played sound
  | "busy" // Dashi is listening for something else
  | "muted" // the microphone is muted: "The microphone is muted"
  | "loading" // the speech model is still loading: say so and that a second press will work
  | "secret" // d-20: a password field has the keyboard; the microphone never opened
  | "ended"; // d-33: hands-free ended by a tap or a change of window (never silently)

export type DictationState =
  /** d-01. Nothing shows. */
  | { phase: "idle" }
  /** d-02. The key is down, not yet a hold. */
  | { phase: "key-down" }
  /** A hold, and the microphone is not open yet: never drawn as listening. */
  | { phase: "opening" }
  /** d-03, d-04, d-29, d-30. The microphone is open. `hint` is a line to teach the key the first time ("Hold to dictate. Let go to type."), else null. `text` is everything heard so far ("" at first; partials come about every 0.8 s). `handsFree` with when it ends by itself. */
  | { phase: "listening"; text: string; handsFree: boolean; endsAt: number | null; hint: string | null }
  /** d-05. The key came up: the words are worked out and tidied. `text` is the last partial. */
  | { phase: "tidying"; text: string }
  /** d-06, d-09, d-14. The words landed. `line` is the capsule's one line ("Typed. 2 fillers out."); `changes` is why; `heard` differs from `typed` when tidying changed something. */
  | { phase: "landed"; typed: string; heard: string; changes: readonly TidyChange[]; line: string; until: number }
  /** d-17, d-18, d-20. Not typed: the words wait here, in memory, until `until` (ten minutes), with Copy. */
  | { phase: "waiting"; text: string; heard: string; reason: WaitReason; line: string; until: number }
  /** d-23, d-25 to d-28, d-32, d-33. One line, then idle at `until`. */
  | { phase: "notice"; trouble: DictationTrouble; line: string; until: number };

export type DictationPhase = DictationState["phase"];

/** What the capsule asks of the engine. */
export type DictationCommand =
  /** Copy: the waiting (or landed) words to the clipboard. `heard` copies them as said. */
  | { do: "copy"; heard?: boolean }
  /** The square, or a tap on a hands-free capsule: end the listen and land what was said. */
  | { do: "finish" }
  /** Close: drop what waits or shows. Nothing is typed. */
  | { do: "dismiss" }
  /** Land these words as a dictation would (tidied, typed or waiting): Dashi's capsule's "Type it instead". */
  | { do: "type"; text: string };

/** The limits (pill-v2 README, "What tidying may do"), in ms. */
export const DICTATION_LIMITS = {
  /** A hold with nothing said. */
  silentHold: 30_000,
  /** Any hold. */
  hold: 300_000,
  /** Hands-free: quiet this long ends it. */
  handsFreeQuiet: 20_000,
  /** Hands-free, whatever happens. */
  handsFree: 600_000,
  /** Words that were not typed wait this long. */
  waiting: 600_000,
  /** How long "Typed" stays. */
  landed: 6_000,
  /** How long a notice stays. */
  notice: 4_000,
} as const;

/** settings.json `dictation` (Settings › Voice). */
export interface DictationSettings {
  /** On whenever Voice is on (`voice.on`, with its listening models here) unless this is false. */
  on?: boolean;
  /** The dictation key (keys.ts `DictationKeyId`); `auto` unless set. */
  key?: string;
  /** Double tap for hands-free; on unless false. */
  handsFree?: boolean;
  /** Tidy by rule; on unless false. Off types the words as heard. */
  tidy?: boolean;
}
