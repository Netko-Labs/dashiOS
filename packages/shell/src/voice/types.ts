/** What the voice module shows and is given (docs/voice.md is the service's side). */

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
  /** Something to tell the person where they look: what is missing and the one thing to do. */
  | { kind: "notice"; text: string; go?: ChipGo };

/** What the agent answered a spoken ask with. */
export interface Answer {
  /** Said out loud, and shown as captions. */
  say: string;
  /** It didn't answer (no agent, not signed in): the words also stay in the chip, which goes there when pressed. */
  failed?: { go?: ChipGo };
}

/** Who answers what was said: the launcher's agent (boot/voice.ts). */
export interface Asker {
  ask(words: string, signal: AbortSignal): Promise<Answer>;
}

/** Voice's part of settings.json. */
export interface VoiceSettings {
  /** Off until the person turns it on in Settings › Voice. */
  on?: boolean;
  /** The talk key (keys.ts); the right ❖ or the Copilot key unless set. */
  key?: string;
  /** Dashi's voice, a voice id of the service's; its own (`af_heart`) unless set. */
  voice?: string;
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
