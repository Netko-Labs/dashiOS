/**
 * The models the shell drives itself for Dashi's assistant (way two,
 * decisions.md D148): Claude with the person's key, and a model on this
 * computer through Ollama. One request a turn, streamed, so the words are
 * spoken as they are written; the loop around them is model-loop.ts.
 *
 * - Claude (claude-model.ts): the Messages API as the launcher's answerer calls it
 *   (agents/ask/lib/claude.ts: the same model, version, effort and
 *   fallbacks), with `stream: true`, the system prompt and the tools cached,
 *   and the tools not strict (all of Dashi's are offered; the server checks
 *   every call's arguments and says what is wrong). The key goes in this
 *   request's headers and nowhere else.
 * - Ollama (local-model.ts): `/api/chat` on the loopback address, streamed as JSON lines. A
 *   small model can't hold every tool: it is offered a fixed core and the
 *   ones the words name.
 */

import { isRecord } from "@dashi/shape";
import type { Fetch } from "../../ask/index.ts";

export interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface WantedCall {
  id: string;
  name: string;
  input: unknown;
}

/** How a call went, as the model is told. */
export interface CallResult {
  call: WantedCall;
  text: string;
  error: boolean;
  images: ReadonlyArray<{ data: string; mimeType: string }>;
}

export interface ModelTurn {
  text: string;
  calls: WantedCall[];
  /** The model's message, as this provider takes it back next turn. */
  echo: unknown;
}

export interface TurnInput {
  system: string;
  messages: readonly unknown[];
  tools: readonly ToolSpec[];
  /** The person's words, for a model that is offered only the tools they name. */
  words: string;
  signal: AbortSignal;
  onText(delta: string): void;
}

/** A model the shell asks, one streamed request a turn; its messages are its own shape. */
export interface ChatModel {
  /** A message of the person's words. */
  user(text: string): unknown;
  /** A message of the assistant's own words (what was said before it was interrupted). */
  said(text: string): unknown;
  /** The last reply's calls, answered. */
  results(results: readonly CallResult[]): unknown[];
  turn(input: TurnInput): Promise<ModelTurn>;
}

export const TIMEOUT_MS = 120_000;
export const send = (fetching: Fetch | undefined): Fetch => fetching ?? ((url, init) => fetch(url, init));

/** A response body's lines as they come. */
export async function* linesOf(response: Response): AsyncGenerator<string> {
  if (!response.body) return;
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of response.body) {
    rest += decoder.decode(chunk, { stream: true });
    for (let at = rest.indexOf("\n"); at >= 0; at = rest.indexOf("\n")) {
      yield rest.slice(0, at);
      rest = rest.slice(at + 1);
    }
  }
  if (rest.trim()) yield rest;
}

export const parsed = (text: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};
