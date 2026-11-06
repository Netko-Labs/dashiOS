/**
 * Claude as the launcher's answerer: one Messages API request per turn, to
 * api.anthropic.com only, with the person's key (keys.ts: the vault's token
 * item when there is one). The request carries the person's words and the
 * plan's tools; the reply's `tool_use` blocks are the plan. Plain `fetch`, so
 * the shell takes no new dependency and tests hand in their own.
 *
 * The key goes in the `x-api-key` header of this one request and nowhere
 * else: never logged, never in an error, never shown.
 */

import { ANSWERERS, AnswerError, type Answerer, type ModelCall, type PlanTool, SYSTEM_PROMPT, type Turn } from "./answerer.ts";

export const ANTHROPIC_HOST = "api.anthropic.com";
const URL = `https://${ANTHROPIC_HOST}/v1/messages`;
export const CLAUDE_MODEL = "claude-opus-5-5";
const API_VERSION = "2026-10-21";
/** On a declined request the API tries its own fallback model in the same call. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 16_000;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ClaudeOptions {
  /** The key, looked up for each request (it can be added while the shell runs); null when there is none. */
  key(): Promise<string | null>;
  model?: string;
  fetch?: Fetch;
}

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/** The provider's error words, short and on one line. */
function errorWords(body: unknown): string {
  const error = isRaw(body) && isRaw(body.error) ? body.error : null;
  const message = typeof error?.message === "string" ? error.message : "";
  return message.replace(/\s+/g, " ").slice(0, 160);
}

/** The reply's text and calls; anything malformed is a failure, never guessed at. */
export function readReply(body: unknown): { text: string; calls: ModelCall[]; content: unknown[] } {
  if (!isRaw(body) || !Array.isArray(body.content)) throw new AnswerError("failed", "Claude's answer couldn't be read.");
  if (body.stop_reason === "refusal") throw new AnswerError("refused", "Claude declined this request.");
  const text: string[] = [];
  const calls: ModelCall[] = [];
  for (const block of body.content) {
    if (!isRaw(block)) continue;
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
    if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string")
      calls.push({ id: block.id, name: block.name, input: block.input });
  }
  return { text: text.join("\n").trim(), calls, content: body.content };
}

/** The user message for a turn: how the last calls went, then the words. */
export function userMessage(turn: Turn): Raw {
  return {
    role: "user",
    content: [
      ...turn.results.map((result) => ({ type: "tool_result", tool_use_id: result.id, content: result.text, ...(result.error ? { is_error: true } : {}) })),
      { type: "text", text: turn.text },
    ],
  };
}

export function claudeAnswerer(options: ClaudeOptions): Answerer {
  const send = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    info: ANSWERERS.claude,
    async turn(history, turn, tools: readonly PlanTool[], signal) {
      const key = await options.key();
      if (!key) throw new AnswerError("no-key", "Add your Anthropic key in Settings › Agents.");
      const messages = [...history, userMessage(turn)];
      let response: Response;
      try {
        response = await send(URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": API_VERSION,
            "anthropic-beta": FALLBACK_BETA,
          },
          body: JSON.stringify({
            model: options.model ?? CLAUDE_MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            messages,
            tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.schema })),
            tool_choice: { type: "auto" },
            output_config: { effort: "low" },
            fallbacks: "default",
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new AnswerError("no-answer", "Claude didn't answer.");
      }
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) throw new AnswerError("no-key", "Anthropic didn't accept the key.");
      if (response.status === 429 || response.status >= 500) throw new AnswerError("no-answer", "Claude is busy; try again in a moment.");
      if (!response.ok) throw new AnswerError("failed", errorWords(body) || `Claude answered ${response.status}.`);
      const reply = readReply(body);
      return { reply: { text: reply.text, calls: reply.calls }, history: [...messages, { role: "assistant", content: reply.content }] };
    },
  };
}
