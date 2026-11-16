/**
 * The models that rewrite (docs/dictation-rewrite.md, "The model"; decisions.md D170, D200). Each file is fetched by
 * dashi-voice as a set of its own (crates/dashi-voice/src/models/manifest.rs names the same files); the person picks one
 * in Settings › Voice, "Corrections" (settings.json `dictation.corrections`).
 */

import type { CorrectionChoice } from "../types.ts";

export interface LocalModel {
  /** The choice in settings.json. */
  choice: CorrectionChoice;
  /** The set's id in dashi-voice, and its folder under the models' folder. */
  set: string;
  file: string;
  bytes: number;
  /** Its name in the logs (`model=…`). */
  name: string;
  /**
   * Whether the tone and the text before the caret are sent. Not to SpeakoFlow Mini: with them it fixed 67% of English
   * self-corrections instead of 76% (docs/dictation-rewrite.md, "The model"). The vocabulary is always sent.
   */
  context: boolean;
}

export const SPEAKOFLOW: LocalModel = {
  choice: "speakoflow",
  set: "rewrite",
  file: "SpeakoFlow-Mini-0.8B-Q4_K_M.gguf",
  bytes: 541_903_616,
  name: "speakoflow-mini-q4",
  context: false,
};

/** The rewrite engineer's second: as careful, a little behind on self-corrections, far ahead on fillers and names. */
export const GEMMA: LocalModel = {
  choice: "gemma",
  set: "rewrite-gemma",
  file: "gemma-4-E2B-it-Q4_K_M.gguf",
  bytes: 3_106_738_272,
  name: "gemma-4-e2b-q4",
  context: false,
};

export const LOCAL_MODELS: readonly LocalModel[] = [SPEAKOFLOW, GEMMA];

/** The model on this computer for a choice; null for "rules" and "key". */
export const localModel = (choice: CorrectionChoice): LocalModel | null => LOCAL_MODELS.find((model) => model.choice === choice) ?? null;

/** Kept for the code that names the first model: the default. */
export const MODEL = SPEAKOFLOW;
