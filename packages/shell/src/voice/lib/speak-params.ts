/**
 * What `speak` is sent for one sentence of what Dashi says (saying.ts;
 * docs/voice.md, "What the shell does"). Queued, always: a `speak` without
 * it would stop the sentence before. In Dashi's voice it goes with the
 * voices that may speak (tongues.ts) and a language for words that tell
 * none: the sentence before's, and for the first the conversation's.
 */

import type { SpeakExtras } from "../types.ts";

/** All of a run in one voice, read as `language` (a sample); with no language, as the voice reads. */
export interface OneVoice {
  voice: string;
  language?: string | undefined;
}

/** The service's field is `by_language`: false says it all in the one voice. */
const ONE = { by_language: false };

/** `after`: the language the sentence before was said in, as `speak` answered; none for the first. */
export function speakParams(
  text: string,
  after: string | undefined,
  only: OneVoice | undefined,
  prefs: { voice: string | undefined; speak?: SpeakExtras | undefined },
): Record<string, unknown> {
  const base = { text, queue: true };
  if (only) return { ...base, voice: only.voice, ...(only.language ? { language: only.language } : ONE) };
  const own = prefs.voice ? { voice: prefs.voice } : {};
  const speak = prefs.speak;
  if (speak?.byLanguage === false) return { ...base, ...own, ...ONE };
  const hint = after ?? speak?.hint;
  return { ...base, ...own, ...(speak?.voices ? { voices: speak.voices } : {}), ...(hint ? { hint } : {}) };
}
