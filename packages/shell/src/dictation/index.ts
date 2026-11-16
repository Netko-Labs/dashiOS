export { dictationActions, PASTE_LAST_ADDRESS, UNDO_ADDRESS } from "./actions.ts";
export { Dictation } from "./dictation.ts";
export { DictationHistory, type HistoryEntry, historyFile } from "./history.ts";
export {
  DASHI,
  DICTATION,
  DICTATION_KEY_LABELS,
  type DictationKey,
  dictationKey,
  type Layout,
  type PillHeldKey,
  tapClosesLauncher,
  usesAltGr,
} from "./keys.ts";
export { Lexicon, type LexiconView, lexiconDir } from "./lexicon.ts";
export { type KnownNames, knownTerms } from "./lib/seed.ts";
export { type DictationOptions, type DictationParts, startDictation } from "./start.ts";
export { agentUnder } from "./terminal.ts";
export type { DictationDeps, DictationPrefs, FieldRead, Front, Hearing, HearingEvent, Pair, Profile, Term } from "./types.ts";
export { NO_WORDS, systemWords, type Words, wordsFrom } from "./words.ts";
