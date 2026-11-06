/**
 * Claude as the launcher's answerer: one Messages API request per turn,
 * through the official SDK (`@anthropic-ai/sdk`), to api.anthropic.com only,
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
 * The key goes to a client made for this one request, in the shell's own
 * process, and nowhere else: never logged (the SDK's logging is off), never
 * in an error, never shown. The base URL is fixed, so ANTHROPIC_BASE_URL in
 * the session can't send the key elsewhere.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ANSWERERS, AnswerError, type Answerer, type ModelCall, type PlanTool, SYSTEM_PROMPT, type Turn } from "./answerer.ts";
import { strictSchema } from "./strict.ts";

export const ANTHROPIC_HOST = "api.anthropic.com";
const BASE_URL = `https://${ANTHROPIC_HOST}`;
export const CLAUDE_MODEL = "claude-opus-5-5";
/** `fallbacks: "default"` (the scalar form) goes with this header, and only this one. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const TIMEOUT_MS = 60_000;
/** Room for the model's thinking as well as the plan. */
const MAX_TOKENS = 16_000;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;
type Message = Anthropic.Beta.BetaMessage;

export interface ClaudeOptions {
  /** The key, looked up for each request (it can be added while the shell runs); null when there is none. */
  key(): Promise<string | null>;
  model?: string;
  /** For tests: what the SDK sends its requests with. */
  fetch?: Fetch;
  /** How often the SDK tries again after a rate limit, an overload or a dropped connection. */
  maxRetries?: number;
}

/** The provider's error words, short and on one line. */
function errorWords(body: unknown): string {
  const outer = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  const message = typeof outer === "object" && outer !== null ? (outer as { message?: unknown }).message : undefined;
  return typeof message === "string" ? message.replace(/\s+/g, " ").slice(0, 160) : "";
}

/** A plan tool as Claude is told of it: strict, so its arguments fit the schema. */
export const claudeTool = (tool: PlanTool): Anthropic.Beta.BetaTool => ({
  name: tool.name,
  description: tool.description,
  input_schema: strictSchema(tool.schema) as Anthropic.Beta.BetaTool.InputSchema,
  strict: true,
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

/** The reply's text and calls; a refusal or a cut-off reply is a failure, never guessed at. */
export function readReply(message: Pick<Message, "content" | "stop_reason">): { text: string; calls: ModelCall[] } {
  // A refusal comes first: its content may be empty or cut off mid-call.
  if (message.stop_reason === "refusal") throw new AnswerError("refused", "Claude declined this request.");
  if (!Array.isArray(message.content)) throw new AnswerError("failed", "Claude's answer couldn't be read.");
  // A call cut off at max_tokens can still parse; never plan from it.
  if (message.stop_reason === "max_tokens") throw new AnswerError("failed", "Claude's answer was cut off.");
  const text: string[] = [];
  const calls: ModelCall[] = [];
  for (const block of message.content.slice(servedFrom(message.content))) {
    if (block.type === "text") text.push(block.text);
    if (block.type === "tool_use") calls.push({ id: block.id, name: block.name, input: block.input });
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

/** The SDK's errors as the launcher says them; never with the key. */
export function answerFailure(error: unknown): AnswerError {
  if (error instanceof AnswerError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError)
    return new AnswerError("no-key", "Anthropic didn't accept the key.");
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError)
    return new AnswerError("no-answer", "Claude is busy; try again in a moment.");
  if (error instanceof Anthropic.APIConnectionError) return new AnswerError("no-answer", "Claude didn't answer.");
  if (error instanceof Anthropic.APIError)
    return new AnswerError("failed", errorWords(error.error) || (error.status ? `Claude answered ${error.status}.` : "Claude didn't answer."));
  return new AnswerError("no-answer", "Claude didn't answer.");
}

export function claudeAnswerer(options: ClaudeOptions): Answerer {
  const send = options.fetch;
  return {
    info: ANSWERERS.claude,
    async turn(history, turn, tools: readonly PlanTool[], signal) {
      const key = await options.key();
      if (!key) throw new AnswerError("no-key", "Add your Anthropic key in Settings › Agents.");
      const client = new Anthropic({
        apiKey: key,
        baseURL: BASE_URL,
        timeout: TIMEOUT_MS,
        maxRetries: options.maxRetries ?? 1,
        logLevel: "off",
        ...(send ? { fetch: (url: string | URL | Request, init?: RequestInit) => send(url instanceof Request ? url.url : String(url), init ?? {}) } : {}),
      });
      const messages: MessageParam[] = [...(history as readonly MessageParam[]), userMessage(turn)];
      let message: Message;
      try {
        message = await client.beta.messages.create(
          {
            model: options.model ?? CLAUDE_MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            messages,
            tools: tools.map(claudeTool),
            tool_choice: { type: "auto" },
            output_config: { effort: "low" },
            fallbacks: "default",
            betas: [FALLBACK_BETA],
          },
          { signal },
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
