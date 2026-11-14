/** What voice mode reads of 0.8: the voice controller and the launcher's Ask tasks, as much as it uses. */

import type { Chip } from "../../voice/index.ts";
import type { OpenCard } from "../types.ts";

/** 0.8's voice controller (voice/voice.ts). */
export interface VoiceSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Chip | null;
  level: { subscribe(listener: () => void): () => void; getSnapshot(): number };
  stop(): void;
  /** Say `words`; the next thing heard goes to `heard`. Returns what ends it. */
  ask(words: string, heard: (text: string) => void): () => void;
  /** How the person talks ("the right ❖ key"), or null when they can't. */
  talkKey(): string | null;
}

/** A launcher Ask task, as much as voice mode reads of it (agents/ask/types.ts `TaskView`). */
export interface Task {
  id: string;
  /** The words its plan answers. */
  request: string;
  phase: "asking" | "planned" | "running" | "done" | "failed" | "stopped";
  /** What the model said besides its calls. */
  said: string;
  steps: ReadonlyArray<{ title: string; state: { kind: string } }>;
}

/** The launcher's Ask tasks (agents/ask/lib/tasks.ts). */
export interface TaskSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly Task[];
  run(id: string): Promise<void>;
  stop(id: string): void;
}

/** What names a card: its ask's id, or its reading's. */
export const cardId = (card: OpenCard): string => ("ask" in card.what ? card.what.ask.id : card.what.reading.id);
