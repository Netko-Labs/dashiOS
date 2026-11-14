/**
 * Claude as the launcher's answerer: one Messages API request per turn,
 * over `fetch` (http.ts, no SDK), to api.anthropic.com only,
 * with the person's key (keys.ts: the vault's token item when there is one).
 * The request carries the person's words and the plan's tools; the reply's
 * `tool_use` blocks are the plan, checked against the registry before any
 * step is shown (plan.ts).
 *
 * Claude Opus 5.5, as its migration notes say: effort set to `low` in
 * `output_config` (a plan is short; the default would be `medium`), thinking
 * left as the model has it (always on; never `disabled`, never a budget),
 * `tool_choice: auto` with strict tools and the system prompt asking for the
 * calls (forced tool choice is refused on this model), and server-side
 * fallbacks on (`fallbacks: "default"`), so a false-positive decline is
 * answered by the model Anthropic picks for it. A refusal is read before
 * anything else in the reply.
 *
 * The key goes in the headers of this one request, from the shell's own
 * process, and nowhere else: never logged, never
 * in an error, never shown. The base URL is fixed, so ANTHROPIC_BASE_URL in
 * the session can't send the key elsewhere.
 */

import { isRecord } from "@dashi/shape";
import { ANSWERERS, AnswerError, type Answerer, type ModelCall, type PlanTool, systemPrompt, type Turn } from "../answerer.ts";
import { errorWords, type Fetch, HttpError, requestJson, UnreadableError } from "./http.ts";
import { strictSchema } from "./strict.ts";

export const ANTHROPIC_HOST = "api.anthropic.com";
const ENDPOINT = `https://${ANTHROPIC_HOST}/v1/messages`;
export const CLAUDE_MODEL = "claude-opus-5-5";
/** The API version the requests are written for (platform.claude.com, "API overview"). */
export const ANTHROPIC_VERSION = "2026-10-21";
/** `fallbacks: "default"` (the scalar form) goes with this header, and only this one. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const TIMEOUT_MS = 60_000;
/** Room for the model's thinking as well as the plan. */
const MAX_TOKENS = 16_000;

/** A content block of a message; the fields a type has beyond `type` are read where they're used. */
export interface ContentBlock {
  type: string;
  [field: string]: unknown;
}
interface MessageParam {
  role: "user" | "assistant";
  content: string | readonly unknown[];
}
/** The parts of a reply that are read. */
interface Message {
  content: readonly ContentBlock[];
  // biome-ignore lint/style/useNamingConvention: the API's field name
  stop_reason?: string | null;
}

export interface ClaudeOptions {
  /** The key, looked up for each request (it can be added while the shell runs); null when there is none. */
  key(): Promise<string | null>;
  model?: string;
  /** For tests: what the requests are sent with. */
  fetch?: Fetch;
  /** How often to try again after a rate limit, an overload or a dropped connection. */
  maxRetries?: number;
}

/** A tool in Claude's request: the API's own field names. */
export interface ClaudeTool {
  name: string;
  description: string;
  // biome-ignore lint/style/useNamingConvention: the API's field.
  input_schema: Record<string, unknown>;
  strict: true;
}

/** A plan tool as Claude is told of it: strict, so its arguments fit the schema. */
export const claudeTool = (tool: PlanTool): ClaudeTool => ({
  name: tool.name,
  description: tool.description,
  input_schema: strictSchema(tool.schema),
  strict: true as const,
});

/** Where the model that answered starts: after the last fallback block, if a fallback ran. */
const servedFrom = (content: readonly ContentBlock[]): number => content.findLastIndex((block) => block.type === "fallback") + 1;

/**
 * The reply's content as it goes back next turn. After a fallback, the
 * declined model's thinking and tool calls before the switch are left out,
 * as the API asks; everything else goes back as it came.
 */
export function echoed(content: readonly ContentBlock[]): ContentBlock[] {
  const start = servedFrom(content);
  return content.filter((block, at) => at >= start || !(block.type === "thinking" || block.type === "redacted_thinking" || block.type === "tool_use"));
}

const isBlock = (block: unknown): block is ContentBlock => isRecord(block) && typeof block.type === "string";
/** A message of the history this answerer handed back last time: read again, not taken on its word. */
const isMessageParam = (value: unknown): value is MessageParam =>
  isRecord(value) && (value.role === "user" || value.role === "assistant") && (typeof value.content === "string" || Array.isArray(value.content));

/** The answer body as a message; anything else is an answer that can't be read. */
export function readMessage(body: unknown): Message {
  const content = isRecord(body) && Array.isArray(body.content) ? body.content : null;
  if (!isRecord(body) || content === null || !content.every(isBlock)) throw new AnswerError("failed", "Claude's answer couldn't be read.");
  return { content, stop_reason: typeof body.stop_reason === "string" ? body.stop_reason : null };
}

/** The reply's text and calls; a refusal or a cut-off reply is a failure, never guessed at. */
export function readReply(message: Message): { text: string; calls: ModelCall[] } {
  // A refusal comes first: its content may be empty or cut off mid-call.
  if (message.stop_reason === "refusal") throw new AnswerError("refused", "Claude declined this request.");
  // A call cut off at max_tokens can still parse; never plan from it.
  if (message.stop_reason === "max_tokens") throw new AnswerError("failed", "Claude's answer was cut off.");
  const text: string[] = [];
  const calls: ModelCall[] = [];
  for (const block of message.content.slice(servedFrom(message.content))) {
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
    if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string")
      calls.push({ id: block.id, name: block.name, input: block.input });
  }
  return { text: text.join("\n").trim(), calls };
}

/** The user message for a turn: how the last calls went, then the words. */
export function userMessage(turn: Turn): MessageParam {
  return {
    role: "user",
    content: [
      ...turn.results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.id,
        content: result.text,
        ...(result.error ? { is_error: true } : {}),
      })),
      { type: "text" as const, text: turn.text },
    ],
  };
}

/** What went wrong with a request, as the launcher says it; never with the key. */
export function answerFailure(error: unknown): AnswerError {
  if (error instanceof AnswerError) return error;
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) return new AnswerError("no-key", "Anthropic didn't accept the key.");
    // 429 is a rate limit, 5xx an outage; 529 is Anthropic's "overloaded".
    if (error.status === 429 || error.status >= 500) return new AnswerError("no-answer", "Claude is busy; try again in a moment.");
    return new AnswerError("failed", errorWords(error.body) || `Claude answered ${error.status}.`);
  }
  if (error instanceof UnreadableError) return new AnswerError("failed", "Claude's answer couldn't be read.");
  return new AnswerError("no-answer", "Claude didn't answer.");
}

export function claudeAnswerer(options: ClaudeOptions): Answerer {
  return {
    info: ANSWERERS.claude,
    async turn(history, turn, tools: readonly PlanTool[], signal) {
      const key = await options.key();
      if (!key) throw new AnswerError("no-key", "Add your Anthropic key in Settings › Agents.");
      const messages: MessageParam[] = [...history.filter(isMessageParam), userMessage(turn)];
      let message: Message;
      try {
        message = readMessage(
          await requestJson({
            url: ENDPOINT,
            headers: { authorization: `Bearer ${key}`, "anthropic-version": ANTHROPIC_VERSION, "anthropic-beta": FALLBACK_BETA },
            body: {
              model: options.model ?? CLAUDE_MODEL,
              max_tokens: MAX_TOKENS,
              system: systemPrompt(),
              messages,
              tools: tools.map(claudeTool),
              tool_choice: { type: "auto" },
              output_config: { effort: "low" },
              fallbacks: "default",
            },
            signal,
            timeoutMs: TIMEOUT_MS,
            retries: options.maxRetries ?? 1,
            ...(options.fetch ? { fetch: options.fetch } : {}),
          }),
        );
      } catch (error) {
        if (signal.aborted) throw error;
        throw answerFailure(error);
      }
      const reply = readReply(message);
      return { reply, history: [...messages, { role: "assistant", content: echoed(message.content) }] };
    },
  };
}
