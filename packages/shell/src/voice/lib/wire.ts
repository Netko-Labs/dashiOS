/** dashi-voice's replies and events as the shell reads them (docs/voice.md): parsed, never cast. */

import { bool, type Infer, int, lenientList, literal, num, obj, optional, record, str, tagged } from "@dashi/shape";

const LOOSE = { strict: false } as const;
const loose = <F extends Parameters<typeof obj>[0]>(fields: F) => obj(fields, LOOSE);

const State = literal("idle", "listening", "thinking", "speaking");

export const StatusShape = loose({ state: State, listen: bool(), speak: bool(), whisper: bool(), fetching: bool() });
export type VoiceStatus = Infer<typeof StatusShape>;

const SetShape = loose({ id: str(), name: str(), about: str(), credit: str(), basic: bool(), bytes: num(), have: num(), installed: bool() });
export type ModelSet = Infer<typeof SetShape>;

export const ModelsShape = loose({ folder: optional(str()), fetching: bool(), sets: lenientList(SetShape, { max: 16 }) });

/** `pairs`: the voice of each other language that goes with this one, by the language's code. */
const VoiceShape = loose({ id: str(), name: str(), language: str(), language_name: str(), installed: bool(), pairs: optional(record(str())) });
export type SpokenVoice = Infer<typeof VoiceShape>;

export const VoicesShape = loose({ default: str(), voices: lenientList(VoiceShape, { max: 64 }) });

export const FetchReply = loose({ bytes: num(), fetching: bool() });
/** `ended`: why the listen ended ("key-up(224)", "silence(1824)"); `model`: what heard it ("parakeet-v3"). */
export const HeardReply = loose({ text: str(), language: optional(str()), ended: optional(str()), model: optional(str()), speech_ms: optional(num()) });
/** `language`: the language its last sentence is said in ("es"). */
export const SpeakReply = loose({ id: int(), language: optional(str()) });

const Word = loose({ text: str(), start: num(), end: num() });
export type SpokenWord = Infer<typeof Word>;

const EVENTS = {
  state: loose({ state: State }),
  level: loose({ level: num() }),
  partial: loose({ text: str() }),
  heard: loose({ text: str(), language: optional(str()), ended: optional(str()), model: optional(str()), speech_ms: optional(num()) }),
  /** The detector heard the person begin to speak, once a listen. */
  speech: loose({}),
  sentence: loose({
    id: int(),
    index: int(),
    text: str(),
    ms: num(),
    words: lenientList(Word, { max: 2000 }),
    voice: optional(str()),
    language: optional(str()),
  }),
  spoken: loose({ id: int(), reason: literal("done", "stopped", "failed"), error: optional(str()) }),
  fetch: loose({ received: num(), bytes: num(), done: bool(), error: optional(str()) }),
  models: loose({}),
  error: loose({ message: str() }),
};

export const VoiceEventShape = tagged("event", EVENTS);
export type VoiceEvent = Infer<typeof VoiceEventShape>;

/** The line each listen leaves in the shell's log: why it ended, how much speech, and what heard it. */
export const endedLine = (heard: Infer<typeof HeardReply>): string =>
  `listen ended reason=${heard.ended ?? "?"} heard_ms=${heard.speech_ms ?? 0} model=${heard.model ?? "?"}`;
