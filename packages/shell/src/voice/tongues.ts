/**
 * The languages Dashi speaks beside its voice's own, and the voice that says each (docs/voice.md,
 * "A voice for each language"). The service tells each sentence's language and changes voice; this
 * says which languages may be spoken and by whom, from settings.json `voice.voices`, and what
 * `speak` is sent with: the voices, the region each is read by, and the conversation's language.
 */

import type { SpeakExtras, SpokenVoice, VoiceSettings } from "./types.ts";

/** The languages dashi-voice has voices for, by their code. */
export const TONGUES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "hi", name: "Hindi" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
] as const;

export type TongueCode = (typeof TONGUES)[number]["code"];

/** Spoken beside the voice's own unless turned off; the others are off until turned on. */
const USUAL: readonly string[] = ["en", "es"];

const isTongue = (code: string): code is TongueCode => TONGUES.some((each) => each.code === code);

/** "es-CO", "es_CO.UTF-8" and "ES" are "es". */
export const tongueOf = (language: string): string => language.split(/[-_.]/)[0]?.toLowerCase() ?? "";

/** settings.json `voice.voices`: a voice's id for a language that is spoken, `false` for one that is not. */
export const isVoiceMap = (value: unknown): value is Record<string, string | false> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.entries(value).every(([code, voice]) => isTongue(code) && (voice === false || (typeof voice === "string" && /^[a-z]{2}_[a-z]{1,24}$/.test(voice))));

/**
 * The tag a language is read by. Spanish takes the region of the person's formats ("es-CO": `$` is
 * pesos there); with none it is Latin American ("es-419"), as nine in ten of its speakers say it,
 * and Spain's only where the formats are Spain's. The others are read as their voices are.
 */
export function tagOf(code: string, formats: string | undefined): string {
  if (code !== "es") return code;
  const [language, region] = (formats ?? "").split(".")[0]?.split(/[-_]/) ?? [];
  return language?.toLowerCase() === "es" && region ? `es-${region.toUpperCase()}` : "es-419";
}

/** Another language Dashi may speak: who says it now (`null`: nobody, it is off) and who could. */
export interface SpokenTongue {
  code: TongueCode;
  name: string;
  voice: string | null;
  /** The voice of this language that goes with Dashi's (the service's pair), else its first. */
  pair: string | null;
  choices: readonly SpokenVoice[];
}

/** Every language but the voice's own that has a voice here, each with the voice that says it. */
export function spokenTongues(settings: VoiceSettings, voices: readonly SpokenVoice[], own: string): SpokenTongue[] {
  const mine = voices.find((voice) => voice.id === own);
  return TONGUES.filter((tongue) => tongue.code !== tongueOf(mine?.language ?? "en")).flatMap((tongue) => {
    const choices = voices.filter((voice) => voice.installed && tongueOf(voice.language) === tongue.code);
    if (choices.length === 0) return [];
    const chosen = settings.voices?.[tongue.code];
    const on = typeof chosen === "string" || (USUAL.includes(tongue.code) && chosen !== false);
    // The one the person picked; else the pair the service names for the voice; else the language's first.
    const has = (id: string | false | undefined): string | undefined => choices.find((voice) => voice.id === id)?.id;
    const pair = has(mine?.pairs?.[tongue.code]) ?? choices[0]?.id ?? null;
    return [{ ...tongue, voice: on ? (has(chosen) ?? pair) : null, pair, choices }];
  });
}

/** What `voice.voices` becomes when a language is given a voice, or turned off (`null`). */
export function withTongue(settings: VoiceSettings, code: TongueCode, voice: string | null): Record<string, string | false> | undefined {
  const next: Record<string, string | false> = { ...settings.voices };
  if (voice !== null) next[code] = voice;
  else if (USUAL.includes(code)) next[code] = false;
  else delete next[code];
  return Object.keys(next).length > 0 ? next : undefined;
}

export interface SpeakContext {
  /** The region's formats ("es_CO.UTF-8"), else the session's locale. */
  formats?: string | undefined;
  /** The language of what the person last said, as the service told it. */
  heard?: string | undefined;
  /** The language the character answers in, when the person chose one ("en", "es"). */
  persona?: string | undefined;
}

/**
 * The voices `speak` may change to and the conversation's language. The hint is what the person
 * last spoke, else the language they chose for Dashi, else their formats': a first sentence that
 * gives no evidence ("OK.") is said in it.
 */
export function speakExtras(settings: VoiceSettings, voices: readonly SpokenVoice[], own: string, context: SpeakContext): SpeakExtras {
  if (settings.byLanguage === false) return { byLanguage: false };
  const mine = voices.find((voice) => voice.id === own);
  if (!mine) return {};
  const named: Record<string, string> = {};
  // The voice's own language comes too when its tag names a region, so it is read by it.
  const mineTag = tagOf(tongueOf(mine.language), context.formats);
  if (mineTag.includes("-") && tongueOf(mine.language) === "es") named[mineTag] = own;
  for (const tongue of spokenTongues(settings, voices, own)) {
    if (tongue.voice !== null) named[tagOf(tongue.code, context.formats)] = tongue.voice;
  }
  const chosen = context.persona === "en" || context.persona === "es" ? context.persona : undefined;
  const hint = [context.heard, chosen, context.formats].map((each) => tongueOf(each ?? "")).find(isTongue);
  return { voices: named, ...(hint ? { hint } : {}) };
}
