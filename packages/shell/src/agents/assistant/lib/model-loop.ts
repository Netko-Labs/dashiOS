/**
 * Way two (decisions.md D148): the shell drives the model. One ask is a
 * loop: the conversation and Dashi's tools go to the model; each call it
 * wants is carried out through a session of the agents' server (the same
 * `tools/list` and `tools/call` an agent on `dashi-mcp` makes, with the
 * assistant's policy: server-local.ts), one at a time, and what it returned
 * goes back; the loop ends at a reply with no call, or when it is stopped.
 * The cap on calls is the session's (it refuses the next one in words the
 * model reads), so the model says where it got to.
 */

import { isRecord } from "@dashi/shape";
import type { LocalLink } from "../../lib/server-local.ts";
import type { CallResult, ChatModel, ToolSpec, WantedCall } from "./models.ts";

export interface ModelAsk {
  model: ChatModel;
  link: LocalLink;
  system: string;
  /** The conversation so far, in the model's own messages. */
  messages: readonly unknown[];
  /** The person's words, and the words with their context as the model reads them. */
  words: string;
  prompt: string;
  signal: AbortSignal;
  say(text: string): void;
}

export interface ModelEnd {
  /** The conversation with this ask added, to send next time. */
  messages: unknown[];
  /** Everything it said, in order. */
  said: string;
}

/** The server's tools as a model is told of them. */
export function toolSpecs(listed: unknown): ToolSpec[] {
  const tools = isRecord(listed) && Array.isArray(listed.tools) ? listed.tools : [];
  return tools.flatMap((tool): ToolSpec[] => {
    if (!isRecord(tool) || typeof tool.name !== "string" || !isRecord(tool.inputSchema)) return [];
    return [{ name: tool.name, description: typeof tool.description === "string" ? tool.description : tool.name, schema: tool.inputSchema }];
  });
}

/** A `tools/call` result as the model is told it: its words, whether it failed, and its pictures. */
export function callResult(call: WantedCall, result: unknown): CallResult {
  const content = isRecord(result) && Array.isArray(result.content) ? result.content : [];
  const text: string[] = [];
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") text.push(part.text);
    if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") images.push({ data: part.data, mimeType: part.mimeType });
  }
  return { call, text: text.join("\n"), error: isRecord(result) && result.isError === true, images };
}

const stopped = (): DOMException => new DOMException("Stopped.", "AbortError");

/** One ask, to its end. Rejects with an AnswerError when the model can't be reached, and an AbortError when it is stopped. */
export async function askModel(ask: ModelAsk): Promise<ModelEnd> {
  const { model, link, signal } = ask;
  await link.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Dashi", version: "1" } }, signal);
  const tools = toolSpecs(await link.request("tools/list", {}, signal));
  const messages: unknown[] = [...ask.messages, model.user(ask.prompt)];
  let said = "";
  for (;;) {
    if (signal.aborted) throw stopped();
    const reply = await model.turn({ system: ask.system, messages, tools, words: ask.words, signal, onText: ask.say });
    messages.push(reply.echo);
    if (reply.text) said += `${said ? "\n\n" : ""}${reply.text}`;
    if (reply.calls.length === 0) return { messages, said };
    // What it says next is a new paragraph, not run into what it said before the calls.
    ask.say("\n\n");
    const results: CallResult[] = [];
    for (const call of reply.calls) {
      if (signal.aborted) throw stopped();
      const input = isRecord(call.input) ? call.input : {};
      const result = await link.request("tools/call", { name: call.name, arguments: input }, signal).catch((error: unknown) => {
        if (signal.aborted) throw stopped();
        // A tool Dashi doesn't have, or a request it refused: the model is told, and can do something else.
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
      });
      results.push(callResult(call, result));
    }
    messages.push(...model.results(results));
  }
}
