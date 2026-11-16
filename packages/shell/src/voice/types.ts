/** What the voice module shows and is given (docs/voice.md is the service's side). */

import type { Timers } from "../shared/time/index.ts";
import type { heldKeys, TalkKey } from "./keys.ts";
import type { VoiceService } from "./lib/service.ts";
import type { ModelSet as WireModelSet, SpokenVoice as WireSpokenVoice } from "./lib/wire.ts";

/** A set of models the service can fetch, as the service names it. */
export type ModelSet = WireModelSet;
/** One of the voices Dashi can speak in. */
export type SpokenVoice = WireSpokenVoice;

/** Where a chip's words send the person when pressed. */
export type ChipGo = "voice" | "agents" | "launcher";

/** The menu bar's voice chip (chip.tsx): one line, in the agents' purple. */
export type Chip =
  /** The key is held: everything heard so far (the chip shows its end), none yet at first. `question` while an agent's question waits. */
  | { kind: "listening"; text: string; question: boolean }
  /** The key came up: what was heard, while the agent thinks or the first sound is made. */
  | { kind: "thinking"; text: string }
  /** Dashi speaks: the sentence's words, and the one being said (`at`, -1 before the first). `full` is the sentence, for a screen reader. */
  | { kind: "speaking"; words: readonly string[]; at: number; full: string }
  /** Dashi is doing something: the step in its own words ("Opening youtube.com"). */
  | { kind: "working"; text: string }
  /** Nothing is said or heard, and the conversation is still open: Dashi has the thread. */
  | { kind: "open" }
  /** Something to tell the person where they look: what is missing and the one thing to do. */
  | { kind: "notice"; text: string; go?: ChipGo };

/** What the agent answered a spoken ask with. */
export interface Answer {
  /** Said out loud, and shown as captions: what is left to say after what `AskHears.say` was given. */
  say: string;
  /** It didn't answer (no agent, not signed in): the words also stay in the chip, which goes there when pressed. */
  failed?: { go?: ChipGo };
}

/** What an ask tells while it is answered: words as they come, and what Dashi is doing. */
export interface AskHears {
  /** Words of the answer, as they are written: each whole sentence is spoken at once, after the ones before. */
  say(text: string): void;
  /** A step, in Dashi's words ("Reading the page"): the capsule's line while it works. */
  step(title: string): void;
  /** The language the words were heard in ("es"), when the service told it: the answer is in it. */
  language?: string | undefined;
}

/** The conversation a spoken ask belongs to, as much as the voice loop needs of it (agents/assistant/). */
export interface Talk {
  /** It is open: the next thing said continues it. */
  open(): boolean;
  subscribe(listener: () => void): () => void;
  /** Dashi's last word was just said, or nothing was said back: it closes a while after this. */
  rested(): void;
  /** Something is said or asked again: it stays open. */
  busy(): void;
  /** ❖Esc with nothing left to stop, or the lock: it is over. */
  end(why: "stopped" | "locked"): void;
}

/** Who answers what was said: Dashi's assistant (boot/voice.ts). */
export interface Asker {
  ask(words: string, signal: AbortSignal, hears?: AskHears): Promise<Answer>;
  talk?: Talk;
  /** The microphone opens: what is in front is read now, before the words are known. */
  prepare?(): void;
}

/** Voice's part of settings.json. */
export interface VoiceSettings {
  /** Off until the person turns it on in Settings › Voice. */
  on?: boolean;
  /** The talk key (keys.ts); the right ❖ or the Copilot key unless set. */
  key?: string;
  /** Dashi's voice, a voice id of the service's; its own (`af_heart`) unless set. */
  voice?: string;
  /** After Dashi speaks in an open conversation, the microphone opens for the reply; on unless false. */
  listenAgain?: boolean;
  /**
   * The voice for each other language Dashi speaks, by the language's code (`es: "ef_dora"`);
   * `false` is a language it does not speak. Unset: English and Spanish, by the voice's pairs (tongues.ts).
   */
  voices?: Record<string, string | false>;
  /** False says everything in the one voice; each sentence in a voice of its own language unless set. */
  byLanguage?: boolean;
}

/** What `speak` is sent beside the text and the voice (`byLanguage` goes as `by_language`). */
export interface SpeakExtras {
  voices?: Record<string, string>;
  hint?: string;
  byLanguage?: false;
}

/** What Settings › Voice reads (models.ts). */
export interface ModelsView {
  /** Whether the service answers: looking at first, then there or not. */
  service: "looking" | "ready" | "missing";
  sets: readonly ModelSet[];
  /** A fetch under way: bytes here of the bytes asked for, and the sets it brings. */
  fetching: { received: number; bytes: number; sets: readonly string[] } | null;
  /** The last fetch or removal's failure, in the service's words. */
  error: string | null;
  voices: readonly SpokenVoice[];
  /** Dashi's own voice. */
  defaultVoice: string;
}

/** Whether Voice can be used, or what is missing, in words with where to go. */
export type Trouble = { text: string; go?: ChipGo } | null;

/** What the voice loop is given (voice.ts). */
export interface VoiceDeps {
  service: VoiceService;
  /** Voice is on (settings.json), its key and voice, whether it listens again after it speaks, and what `speak` is sent (tongues.ts). */
  prefs(): { on: boolean; key: TalkKey; voice: string | undefined; listenAgain?: boolean; speak?: SpeakExtras };
  /** What stops Voice from being used now (models.ts, the service), or null. */
  trouble(): Trouble;
  /** The keys the compositor holds for the shell (`held-keys`). */
  hold(keys: ReturnType<typeof heldKeys>): void;
  asker: Asker;
  /** The session's locale, for a language only Whisper hears. */
  locale?: string | undefined;
  timers?: Timers;
  now?(): number;
  /** One line for the shell's log (an utterance, a failed ask). */
  log?(line: string): void;
}
