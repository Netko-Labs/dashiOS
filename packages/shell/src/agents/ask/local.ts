/**
 * A model on this computer as the launcher's answerer: Ollama's chat API on
 * the loopback address only (127.0.0.1:11434, whatever OLLAMA_HOST says), so
 * "stays on this computer" is true. The model is `agents.localModel` in
 * settings.json, else the first one installed.
 */

import { ANSWERERS, AnswerError, type Answerer, type ModelCall, type PlanTool, systemPrompt } from "./answerer.ts";
import type { Fetch } from "./lib/http.ts";

export const LOCAL_URL = "http://127.0.0.1:11434";
const TIMEOUT_MS = 120_000;
const LIST_TIMEOUT_MS = 2_000;
/** The most tools a local model is told of: every one (about 70, many thousand tokens) overflows its context and takes minutes on a CPU. */
export const LOCAL_TOOLS = 12;
/** Room for the request, the tools and the answer (Ollama's default, 4096, is too small for the tools). */
const LOCAL_CONTEXT = 8192;

/** Words that say nothing about which tool is meant. */
const FILLER = new Set([
  "the",
  "and",
  "then",
  "please",
  "turn",
  "set",
  "make",
  "can",
  "you",
  "for",
  "with",
  "into",
  "that",
  "this",
  "all",
  "now",
  "my",
  "on",
  "off",
  "to",
  "a",
  "an",
  "of",
  "in",
  "it",
]);
const wordsOf = (text: string): string[] =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((word) => word.length >= 3 && !FILLER.has(word));

/**
 * The tools a request names, best first, at most `max`: a word of the request
 * in a tool's name counts most, one in its description less; tools that share
 * no word are left out (a request no tool matches gets the first `max`, as
 * listed, so the model can still say it can't).
 */
export function toolsForRequest(text: string, tools: readonly PlanTool[], max = LOCAL_TOOLS): PlanTool[] {
  const words = wordsOf(text);
  const scored = tools.map((tool, index) => {
    const name = new Set(wordsOf(tool.name.replace(/_/g, " ")));
    const description = new Set(wordsOf(tool.description));
    const score = words.reduce((sum, word) => sum + (name.has(word) ? 3 : 0) + (description.has(word) ? 1 : 0), 0);
    return { tool, index, score };
  });
  const matched = scored.filter((each) => each.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return (matched.length > 0 ? matched : scored).slice(0, max).map((each) => each.tool);
}

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/** A model name as Ollama writes them ("llama3.2:3b", "qwen3:8b"); anything odder is not used. */
export const isModelName = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);

/** The models installed, by name; null when Ollama isn't running here. */
export async function localModels(send: Fetch = (url, init) => fetch(url, init), signal?: AbortSignal): Promise<string[] | null> {
  try {
    const timeout = AbortSignal.timeout(LIST_TIMEOUT_MS);
    const response = await send(`${LOCAL_URL}/api/tags`, { method: "GET", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const models = isRaw(body) && Array.isArray(body.models) ? body.models : [];
    return models.flatMap((model) => (isRaw(model) && isModelName(model.name) ? [model.name] : []));
  } catch {
    return null;
  }
}

/** The reply's words and calls; the calls get ids of their own (Ollama gives none). */
export function readLocalReply(body: unknown, serial: number): { text: string; calls: ModelCall[]; message: Raw } {
  const message = isRaw(body) && isRaw(body.message) ? body.message : null;
  if (!message) throw new AnswerError("failed", "The local model's answer couldn't be read.");
  const calls: ModelCall[] = [];
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const [index, call] of toolCalls.entries()) {
    const fn = isRaw(call) && isRaw(call.function) ? call.function : null;
    if (fn && typeof fn.name === "string") calls.push({ id: `local-${serial}-${index}`, name: fn.name, input: fn.arguments ?? {} });
  }
  const text = typeof message.content === "string" ? message.content.trim() : "";
  return { text, calls, message: { role: "assistant", content: text, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) } };
}

export interface LocalOptions {
  /** The model the person named (settings.json `agents.localModel`), or null for the first installed. */
  model(): string | null;
  fetch?: Fetch;
}

export function localAnswerer(options: LocalOptions): Answerer {
  const send = options.fetch ?? ((url, init) => fetch(url, init));
  let serial = 0;
  return {
    info: ANSWERERS.local,
    async turn(history, turn, tools: readonly PlanTool[], signal) {
      const named = options.model();
      const installed = named ? null : await localModels(send, signal);
      if (!named && installed === null) throw new AnswerError("no-answer", "The local model isn't running.");
      const model = named ?? installed?.[0];
      if (!model) throw new AnswerError("no-model", "No local model is installed.");
      const messages = [
        ...(history.length === 0 ? [{ role: "system", content: systemPrompt("small") }] : history),
        ...turn.results.map((result) => ({ role: "tool", content: result.text })),
        { role: "user", content: turn.text },
      ];
      let response: Response;
      try {
        response = await send(`${LOCAL_URL}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            // A plan is a few tool calls: no thinking aloud first (qwen3 and the like spend minutes on a CPU).
            think: false,
            options: { num_ctx: LOCAL_CONTEXT },
            tools: toolsForRequest(turn.text, tools).map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.schema },
            })),
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new AnswerError("no-answer", "The local model didn't answer.");
      }
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 404) throw new AnswerError("no-model", `The local model “${model}” isn't installed.`);
      if (!response.ok) throw new AnswerError("failed", `The local model answered ${response.status}.`);
      const reply = readLocalReply(body, ++serial);
      return { reply: { text: reply.text, calls: reply.calls }, history: [...messages, reply.message] };
    },
  };
}
