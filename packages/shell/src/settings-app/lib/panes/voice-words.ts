/** Settings › Voice's words: the sets by name and size, the voices as choices, and which sets a button names. */

import type { CorrectionChoice } from "../../../rewrite/index.ts";
import type { SpeedWord } from "../../../rewrite/speed-word.ts";
import type { Recognizer } from "../../../voice/index.ts";
import { type ModelSet, type SpokenVoice, sizeWords } from "../../../voice/index.ts";

/** "Listening and Speaking", or with sizes: "Listening (673 MB), Speaking (335 MB)". */
export function setsWords(sets: readonly ModelSet[], sizes = false): string {
  const names = sets.map((set) => (sizes ? `${set.name} (${sizeWords(set.bytes)})` : set.name));
  if (sizes) return names.join(", ");
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * What a fetch would bring, for the row that offers it: only the sets that are not whole yet, each
 * with what is still to come. A set that is already here is not named: "Voice needs 335 MB of
 * models …: Listening (673 MB), Speaking (335 MB)" asked for a model the person had.
 */
export function offerWords(sets: readonly ModelSet[]): string {
  const missing = sets.filter((set) => set.have < set.bytes);
  const need = missing.reduce((sum, set) => sum + set.bytes - set.have, 0);
  const names = missing.map((set) => `${set.name} (${sizeWords(set.bytes - set.have)})`).join(", ");
  return `Voice needs ${sizeWords(need)} of models, fetched once and kept on this computer: ${names}.`;
}

/** Whether the fetch under way (its sets) is this row's. */
export const whatFetching = (fetching: readonly string[], row: readonly string[]): boolean => fetching.some((id) => row.includes(id));

/** What Remove takes: every set from the main row (Voice is off again without its basics), else the row's own. */
export const removeWords = (row: string, ids: readonly string[]): readonly string[] | undefined => (row === "voice/models" ? undefined : ids);

/** The voices as choices, Dashi's own first: "Heart · English (US)". */
export function voiceChoices(voices: readonly SpokenVoice[], own: string): Array<{ value: string; label: string }> {
  const listed = voices.filter((voice) => voice.installed);
  const first = listed.filter((voice) => voice.id === own);
  const rest = listed.filter((voice) => voice.id !== own);
  return [...first, ...rest].map((voice) => ({ value: voice.id, label: `${voice.name} · ${voice.language_name}` }));
}

/** The set dashi-voice fetches for the model that corrects dictation (docs/dictation-rewrite.md). */
export const REWRITE_SET = "rewrite";
/** The larger one the person may choose instead (decisions.md D200). */
export const REWRITE_GEMMA_SET = "rewrite-gemma";

/** What the corrections row offers: what it does, its size, and its licence in words. */
export function correctionsOffer(sets: readonly ModelSet[]): string {
  const bytes = sets.reduce((sum, set) => sum + set.bytes - set.have, 0);
  const about = sets.map((set) => set.about).join(" ");
  return `${about} Optional: ${sizeWords(bytes)}, fetched once. The model is free to use and to share (Apache 2.0). Until it is here, dictation tidies by rule.`;
}

/** The speed test's word, after "On this computer: Corrections." */
export function speedWords(speed: SpeedWord): string {
  if (speed === "too-slow") return " This computer is too slow for it, so dictation tidies by rule.";
  if (speed === "refines") return " It takes a moment here: your words land first, and are corrected right after.";
  return "";
}

/** The recognisers by name, and what each was measured to do (decisions.md D200). */
export const RECOGNIZER_LABELS: Readonly<Record<Recognizer, string>> = { parakeet: "Parakeet v3", whisper: "Whisper turbo" };
export const RECOGNIZER_LINES: Readonly<Record<Recognizer, string>> = {
  parakeet:
    "Parakeet TDT 0.6B v3 by NVIDIA (CC BY 4.0), 673 MB: 25 European languages, the one Dashi is tuned on; 16 words in about a third of a second on the VM's processor.",
  whisper:
    "Whisper large-v3-turbo by OpenAI (MIT), 1.04 GB with More languages: 99 languages; larger and slower on the processor than Parakeet (not timed on Dashi's set yet).",
};

/** What corrects dictation, by name, and the rewrite engineer's measures for each (docs/dictation-rewrite.md, 24-rewrite). */
export const CORRECTION_LABELS: Readonly<Record<CorrectionChoice, string>> = {
  speakoflow: "SpeakoFlow Mini",
  gemma: "Gemma 4 E2B",
  rules: "Rules only",
  key: "Claude (your key)",
};
export const CORRECTION_LINES: Readonly<Record<CorrectionChoice, string>> = {
  speakoflow:
    "On this computer, 542 MB (Apache 2.0). Fixes about three self-corrections in four (76% English, 75% Spanish, 88% mixed), leaves 98.6% of right sentences alone, 0.26 s a sentence.",
  gemma:
    "On this computer, 3.1 GB (Apache 2.0), 4.3 GB of memory while it runs. Self-corrections 72% / 69% / 84%, far better with fillers, odd words and names, 98.6% left alone, 0.5 s a sentence: long ones land first and are corrected after.",
  rules: "Nothing to fetch: fillers, spacing, capitals, spoken punctuation and a plain change of mind. About one self-correction in ten.",
  key: "Claude Haiku 5.5 with the Claude key in Settings › Agents. What you dictate is sent to Anthropic; your words land first and are corrected a moment later. Not yet measured on Dashi's set.",
};
