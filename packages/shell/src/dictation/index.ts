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
export { type DictationOptions, type DictationParts, startDictation } from "./start.ts";
export type { DictationDeps, DictationPrefs, FieldRead, Front, Hearing, HearingEvent } from "./types.ts";
