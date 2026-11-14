/** The capsule's one line, in Dashi's voice: plain, short words (docs/voice.md, "Dictation"). */

import type { DictationTrouble, TidyChange, WaitReason } from "../../shared/pill/index.ts";

/** Taught once: the first time the microphone opens for dictation. */
export const HINT = "Hold to dictate. Let go to type.";

const cut = (text: string, most = 24): string => (text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text);

/** What landed and what tidying did, in a few words: "Typed. 2 fillers out." */
export function landedLine(changes: readonly TidyChange[], how: "typed" | "pasted", asHeard: boolean): string {
  const start = how === "pasted" ? "Pasted." : "Typed.";
  if (asHeard) return `${start} As you said it.`;
  const mind = changes.find((change) => change.kind === "change-of-mind");
  if (mind && mind.kind === "change-of-mind") {
    if (mind.to === "") return `${start} Took back “${cut(mind.from)}”.`;
    return `${start} “${cut(mind.from, 16)}” is now “${cut(mind.to, 16)}”.`;
  }
  const fillers = changes.find((change) => change.kind === "filler");
  if (fillers && fillers.kind === "filler") return `${start} ${fillers.count} ${fillers.count === 1 ? "filler" : "fillers"} out.`;
  return start;
}

const WAITING: Readonly<Record<WaitReason, string>> = {
  "no-field": "Nothing to type into. Your words wait here.",
  "left-window": "The window changed. Your words wait here.",
  moved: "You moved on. Your words wait here.",
  secret: "That is a password field. Your words wait here.",
  failed: "Couldn't type that. Your words wait here.",
};

export const waitingLine = (reason: WaitReason): string => WAITING[reason];

/** `name` is what Dashi is called (the persona's). */
export function troubleLine(trouble: DictationTrouble, name: string, handsFree = false): string {
  switch (trouble) {
    case "no-model":
      return "Dictation needs its models. See Settings › Voice.";
    case "no-microphone":
      return "No microphone. Check Sound settings.";
    case "voice-gone":
      return "Voice isn't running. Log out and in again.";
    case "nothing-said":
      return "I didn't hear anything.";
    case "limit":
      return handsFree ? "Hands-free ended: the time limit." : "Dictation stopped: the time limit.";
    case "sound":
      return "Hands-free ended: this computer played sound.";
    case "busy":
      return `${name} is listening already.`;
    case "muted":
      return "The microphone is muted.";
    case "loading":
      return "Voice is starting. Press again in a moment.";
    case "secret":
      return "No dictation into a password field.";
    case "ended":
      return "Hands-free ended.";
  }
}

/** A refusal of the service's, as one of the troubles the capsule knows. */
export function troubleOf(error: unknown): DictationTrouble {
  const text = error instanceof Error ? error.message : String(error);
  if (/already listening/i.test(text)) return "busy";
  if (/microphone/i.test(text)) return "no-microphone";
  if (/model/i.test(text)) return "no-model";
  return "voice-gone";
}
