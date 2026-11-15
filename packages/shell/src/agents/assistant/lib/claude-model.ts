/** Claude with the person's key, for the shell's own loop: one streamed Messages request a turn (models.ts says how and why). */

import { isRecord } from "@dashi/shape";
import {
  ANTHROPIC_HOST,
  ANTHROPIC_VERSION,
  AnswerError,
  answerFailure,
  CLAUDE_MODEL,
  type ContentBlock,
  echoed,
  FALLBACK_BETA,
  type Fetch,
  HttpError,
  readReply,
} from "../../ask/index.ts";
import { type ChatModel, linesOf, parsed, send, TIMEOUT_MS } from "./models.ts";

/** A Claude stream's events put back together as the message's content blocks. */
export class ClaudeStream {
  readonly content: ContentBlock[] = [];
  private readonly json = new Map<number, string>();
  stop: string | null = null;

  constructor(private readonly onText: (delta: string) => void) {}

  event(event: Record<string, unknown>): void {
    const index = typeof event.index === "number" ? event.index : -1;
    if (event.type === "content_block_start" && isRecord(event.content_block) && typeof event.content_block.type === "string") {
      this.content[index] = { ...event.content_block, type: event.content_block.type };
    } else if (event.type === "content_block_delta" && isRecord(event.delta)) this.delta(index, event.delta);
    else if (event.type === "content_block_stop") this.close(index);
    else if (event.type === "message_delta" && isRecord(event.delta) && typeof event.delta.stop_reason === "string") this.stop = event.delta.stop_reason;
    else if (event.type === "error")
      throw new AnswerError("failed", isRecord(event.error) && typeof event.error.message === "string" ? event.error.message.slice(0, 160) : "Claude stopped.");
  }

  private delta(index: number, delta: Record<string, unknown>): void {
    const block = this.content[index];
    if (!block) return;
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      block.text = `${typeof block.text === "string" ? block.text : ""}${delta.text}`;
      this.onText(delta.text);
    } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string")
      this.json.set(index, `${this.json.get(index) ?? ""}${delta.partial_json}`);
    else if (delta.type === "thinking_delta" && typeof delta.thinking === "string")
      block.thinking = `${typeof block.thinking === "string" ? block.thinking : ""}${delta.thinking}`;
    else if (delta.type === "signature_delta" && typeof delta.signature === "string")
      block.signature = `${typeof block.signature === "string" ? block.signature : ""}${delta.signature}`;
  }

  private close(index: number): void {
    const block = this.content[index];
    const json = this.json.get(index);
    if (block?.type === "tool_use" && json !== undefined) block.input = parsed(json) ?? {};
  }
}

export interface ClaudeOptions {
  key(): Promise<string | null>;
  model?: string;
  fetch?: Fetch;
}

export function claudeModel(options: ClaudeOptions): ChatModel {
  return {
    user: (text) => ({ role: "user", content: text }),
    said: (text) => ({ role: "assistant", content: text }),
    results: (results) => [
      {
        role: "user",
        content: results.map((result) => ({
          type: "tool_result",
          tool_use_id: result.call.id,
          content: [
            { type: "text", text: result.text || (result.error ? "It failed." : "Done.") },
            ...result.images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } })),
          ],
          ...(result.error ? { is_error: true } : {}),
        })),
      },
    ],
    async turn({ system, messages, tools, signal, onText }) {
      const key = await options.key();
      if (!key) throw new AnswerError("no-key", "Add your Anthropic key in Settings › Agents.");
      const stream = new ClaudeStream(onText);
      try {
        const response = await send(options.fetch)(`https://${ANTHROPIC_HOST}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-beta": FALLBACK_BETA,
          },
          body: JSON.stringify({
            model: options.model ?? CLAUDE_MODEL,
            max_tokens: 16_000,
            stream: true,
            // The part that never changes in a conversation is cached: the prompt, and the tools up to the last.
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            messages,
            tools: tools.map((tool, at) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.schema,
              ...(at === tools.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
            })),
            tool_choice: { type: "auto" },
            output_config: { effort: "low" },
            fallbacks: "default",
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        });
        if (!response.ok) throw answerFailure(new HttpError(response.status, await response.json().catch(() => null)));
        for await (const line of linesOf(response)) {
          const event = line.startsWith("data:") ? parsed(line.slice(5)) : null;
          if (event) stream.event(event);
        }
      } catch (error) {
        if (signal.aborted) throw error;
        throw error instanceof AnswerError ? error : new AnswerError("no-answer", "Claude didn't answer.");
      }
      const content = stream.content.filter(Boolean);
      const reply = readReply({ content, stop_reason: stream.stop });
      return { ...reply, echo: { role: "assistant", content: echoed(content) } };
    },
  };
}
