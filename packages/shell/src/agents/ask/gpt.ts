/**
 * GPT as the launcher's answerer: one Chat Completions request per turn,
 * through OpenAI's official SDK (`openai`), to api.openai.com only, with the
 * person's key (keys.ts: the vault's token item `openai` when there is one,
 * else OPENAI_API_KEY). The request carries the person's words and the
 * plan's tools as strict function tools; the reply's tool calls are the
 * plan, checked against the registry before any step is shown (plan.ts).
 *
 * The model is `agents.gptModel` in settings.json, else the most capable
 * chat model the key's `/v1/models` lists (gpt-models.ts); the list is
 * asked for again every ten minutes. Strict function tools take every
 * property as required: an optional one is sent as nullable, and a null
 * that comes back is dropped before the action's check (`gptSchema`,
 * `withoutNulls`). The SDK's typed errors say what went wrong; a refusal, a
 * content filter, or a reply cut off at its length is never a plan.
 *
 * The key goes to a client made for that request, in the shell's own
 * process, and nowhere else: never logged (the SDK's logging is off),
 * never in an error, never shown. The base URL is fixed (OPENAI_BASE_URL in
 * the session can't send the key elsewhere), and the organization and
 * project are never read from the session.
 */

import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionFunctionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ANSWERERS, AnswerError, type Answerer, type ModelCall, type PlanTool, SYSTEM_PROMPT, type Turn } from "./answerer.ts";
import type { Fetch } from "./claude.ts";
import { rankGptModels } from "./gpt-models.ts";
import { strictSchema } from "./strict.ts";

export const OPENAI_HOST = "api.openai.com";
const BASE_URL = `https://${OPENAI_HOST}/v1`;
const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 16_000;
/** How long a list of the key's models stands. */
const MODELS_FRESH_MS = 10 * 60_000;

type Schema = Record<string, unknown>;
const isSchema = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value);

/** `schema` with `null` allowed too. */
function nullable(schema: Schema): Schema {
  if (Array.isArray(schema.anyOf)) return { ...schema, anyOf: [...schema.anyOf, { type: "null" }] };
  const type = schema.type;
  const out: Schema = { ...schema };
  if (typeof type === "string") out.type = type === "null" ? type : [type, "null"];
  else if (Array.isArray(type)) out.type = type.includes("null") ? type : [...type, "null"];
  else return { anyOf: [schema, { type: "null" }] };
  if (Array.isArray(schema.enum) && !schema.enum.includes(null)) out.enum = [...schema.enum, null];
  return out;
}

/**
 * A plan tool's schema as OpenAI's strict function tools take it: what
 * strict.ts keeps, with every object's properties all required, the ones
 * that weren't made nullable.
 */
export function gptSchema(schema: unknown): Schema {
  const walk = (node: Schema): Schema => {
    const out: Schema = { ...node };
    if (isSchema(node.items)) out.items = walk(node.items);
    for (const key of ["anyOf", "allOf"] as const)
      if (Array.isArray(node[key])) out[key] = (node[key] as unknown[]).map((each) => (isSchema(each) ? walk(each) : each));
    if (isSchema(node.$defs)) out.$defs = Object.fromEntries(Object.entries(node.$defs).map(([name, each]) => [name, isSchema(each) ? walk(each) : each]));
    if (isSchema(node.properties)) {
      const required = new Set(Array.isArray(node.required) ? node.required : []);
      const properties = Object.entries(node.properties).map(([name, each]): [string, Schema] => {
        const inner = isSchema(each) ? walk(each) : {};
        return [name, required.has(name) ? inner : nullable(inner)];
      });
      out.properties = Object.fromEntries(properties);
      out.required = properties.map(([name]) => name);
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(strictSchema(schema));
}

/** A call's arguments without the nulls strict mode had it send for what wasn't given. */
export function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (!isSchema(value)) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, each]) => (each === null ? [] : [[key, withoutNulls(each)]])));
}

export const gptTool = (tool: PlanTool): ChatCompletionFunctionTool => ({
  type: "function",
  function: { name: tool.name, description: tool.description, parameters: gptSchema(tool.schema), strict: true },
});

/** The reply's words and calls; a refusal, a filtered or a cut-off reply is a failure, never guessed at. */
export function readGptReply(completion: Pick<ChatCompletion, "choices">): { text: string; calls: ModelCall[]; message: ChatCompletionMessageParam } {
  const choice = completion.choices[0];
  if (!choice) throw new AnswerError("failed", "GPT's answer couldn't be read.");
  const { message, finish_reason: finish } = choice;
  if (message.refusal) throw new AnswerError("refused", "GPT declined this request.");
  if (finish === "content_filter") throw new AnswerError("refused", "GPT declined this request.");
  if (finish === "length") throw new AnswerError("failed", "GPT's answer was cut off.");
  const calls: ModelCall[] = [];
  for (const call of message.tool_calls ?? []) {
    if (call.type !== "function") continue;
    let input: unknown = null;
    try {
      input = withoutNulls(JSON.parse(call.function.arguments));
    } catch {
      // Arguments that don't parse: the step can't run, and says so (plan.ts).
    }
    calls.push({ id: call.id, name: call.function.name, input });
  }
  const text = (message.content ?? "").trim();
  return {
    text,
    calls,
    message: { role: "assistant", content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) },
  };
}

/** The messages for a turn: how the last calls went, then the words. */
export function gptMessages(history: readonly ChatCompletionMessageParam[], turn: Turn): ChatCompletionMessageParam[] {
  return [
    ...(history.length === 0 ? [{ role: "developer" as const, content: SYSTEM_PROMPT }] : history),
    ...turn.results.map((result) => ({ role: "tool" as const, tool_call_id: result.id, content: result.error ? `Error: ${result.text}` : result.text })),
    { role: "user" as const, content: turn.text },
  ];
}

/** The provider's error words, short and on one line. */
const errorWords = (error: InstanceType<typeof OpenAI.APIError>): string => {
  const message = typeof error.error === "object" && error.error !== null ? (error.error as { message?: unknown }).message : undefined;
  return typeof message === "string" ? message.replace(/\s+/g, " ").slice(0, 160) : "";
};

/** The SDK's errors as the launcher says them; never with the key. */
export function gptFailure(error: unknown, model: string | null = null): AnswerError {
  if (error instanceof AnswerError) return error;
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError)
    return new AnswerError("no-key", "OpenAI didn't accept the key.");
  if (error instanceof OpenAI.NotFoundError && model) return new AnswerError("no-model", `The model “${model}” isn't available to your key.`);
  if (error instanceof OpenAI.RateLimitError) {
    return error.code === "insufficient_quota"
      ? new AnswerError("failed", "Your OpenAI account has no credit left.")
      : new AnswerError("no-answer", "GPT is busy; try again in a moment.");
  }
  if (error instanceof OpenAI.InternalServerError) return new AnswerError("no-answer", "GPT is busy; try again in a moment.");
  if (error instanceof OpenAI.APIConnectionError) return new AnswerError("no-answer", "GPT didn't answer.");
  if (error instanceof OpenAI.APIError)
    return new AnswerError("failed", errorWords(error) || (error.status ? `OpenAI answered ${error.status}.` : "GPT didn't answer."));
  return new AnswerError("no-answer", "GPT didn't answer.");
}

export interface GptOptions {
  /** The key, looked up for each request; null when there is none. */
  key(): Promise<string | null>;
  /** The model the person named (settings.json `agents.gptModel`), or null for the most capable listed. */
  model(): string | null;
  fetch?: Fetch;
  maxRetries?: number;
  now?(): number;
}

/** A client for one request, with the key, the fixed base URL, and nothing from the session. */
function client(key: string, options: Pick<GptOptions, "fetch" | "maxRetries">): OpenAI {
  const send = options.fetch;
  return new OpenAI({
    apiKey: key,
    baseURL: BASE_URL,
    organization: null,
    project: null,
    timeout: TIMEOUT_MS,
    maxRetries: options.maxRetries ?? 1,
    logLevel: "off",
    ...(send ? { fetch: (url: string | URL | Request, init?: RequestInit) => send(url instanceof Request ? url.url : String(url), init ?? {}) } : {}),
  });
}

/** The chat models the key lists, the most capable first. */
export async function listGptModels(key: string, options: Pick<GptOptions, "fetch" | "maxRetries"> = {}, signal?: AbortSignal): Promise<string[]> {
  const ids: string[] = [];
  for await (const model of client(key, options).models.list(signal ? { signal } : undefined)) ids.push(model.id);
  return rankGptModels(ids);
}

export function gptAnswerer(options: GptOptions): Answerer {
  let listed: { key: string; at: number; models: string[] } | null = null;
  const now = () => options.now?.() ?? Date.now();
  return {
    info: ANSWERERS.gpt,
    async turn(history, turn, tools: readonly PlanTool[], signal) {
      const key = await options.key();
      if (!key) throw new AnswerError("no-key", "Add your OpenAI key in Settings › Agents.");
      let model = options.model();
      try {
        if (!model) {
          if (!listed || listed.key !== key || now() - listed.at > MODELS_FRESH_MS)
            listed = { key, at: now(), models: await listGptModels(key, options, signal) };
          model = listed.models[0] ?? null;
          if (!model) throw new AnswerError("no-model", "Your OpenAI key lists no chat model.");
        }
        const messages = gptMessages(history as readonly ChatCompletionMessageParam[], turn);
        const completion = await client(key, options).chat.completions.create(
          {
            model,
            messages,
            ...(tools.length > 0 ? { tools: tools.map(gptTool), tool_choice: "auto" as const } : {}),
            max_completion_tokens: MAX_TOKENS,
            store: false,
          },
          { signal },
        );
        const reply = readGptReply(completion);
        return { reply: { text: reply.text, calls: reply.calls }, history: [...messages, reply.message] };
      } catch (error) {
        if (signal.aborted) throw error;
        throw gptFailure(error, model);
      }
    },
  };
}
