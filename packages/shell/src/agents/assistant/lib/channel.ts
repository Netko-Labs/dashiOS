/**
 * The model each turn is answered with (decisions.md D262): Settings ›
 * Agents names one for typed asks and one for spoken ones ("Same as typed"
 * unless chosen), per answerer. Each turn uses its own channel's, read when
 * it starts, so a change in Settings applies from the next turn of an open
 * conversation. Unset is the answerer's own default (Claude Code's, the first
 * model Ollama has, Dashi's Claude model for a key).
 */

import { ANSWERERS, type AnswererChoice } from "../../ask/index.ts";
import type { By } from "../transcript.ts";
import type { ModelChoices } from "../types.ts";

/** The model named for this answerer and channel; null for its own default. A spoken turn falls back to the typed one. */
export function modelFor(models: ModelChoices | undefined, answerer: AnswererChoice | undefined, by: By, localModel?: string): string | null {
  if (!answerer || answerer === "none") return null;
  const chosen = models?.[answerer];
  const typed = chosen?.typed ?? (answerer === "local" ? localModel : undefined) ?? null;
  // "default" is the answerer's own default by voice even when a typed model is chosen (Settings' pop-up).
  if (by === "voice" && chosen?.spoken !== undefined) return chosen.spoken === "default" ? null : chosen.spoken;
  return typed;
}

/** What the launcher's header and the log say: "Claude Code · opus", "Local model · its default". */
export function modelLabel(answerer: AnswererChoice | undefined, model: string | null): string {
  const name = answerer && answerer !== "none" ? ANSWERERS[answerer].name : "No answerer";
  return `${name} · ${model ?? "its default"}`;
}
