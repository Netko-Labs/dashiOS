/** Settings › Voice's words: the sets by name and size, the voices as choices, and which sets a button names. */

import type { SpeedWord } from "../../../rewrite/speed-word.ts";
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
