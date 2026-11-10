/**
 * GPT as the launcher's answerer: one Chat Completions request per turn,
 * over `fetch` (http.ts, no SDK), to api.openai.com only, with the
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
 * `withoutNulls`). The status of an error says what went wrong; a refusal, a
 * content filter, or a reply cut off at its length is never a plan.
 *
 * The key goes in the headers of that request, from the shell's own
 * process, and nowhere else: never logged, never in an error, never shown. The base URL is fixed (OPENAI_BASE_URL in
 * the session can't send the key elsewhere), and the organization and
 * project are never sent.
 */

import { ANSWERERS, AnswerError, type Answerer, type ModelCall, type PlanTool, SYSTEM_PROMPT, type Turn } from "./answerer.ts";
import { rankGptModels } from "./gpt-models.ts";
import { errorWords, type Fetch, HttpError, requestJson, UnreadableError } from "./http.ts";
import { strictSchema } from "./strict.ts";

export const OPENAI_HOST = "api.openai.com";
const BASE_URL = `https://${OPENAI_HOST}/v1`;

/** A function call the model made, as it goes back next turn. */
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
/** A chat message, as it is sent. */
interface ChatMessage {
  role: "developer" | "user" | "assistant" | "tool";
  content: string | null;
  // biome-ignore lint/style/useNamingConvention: the API's field name
  tool_call_id?: string;
  // biome-ignore lint/style/useNamingConvention: the API's field name
  tool_calls?: ToolCall[];
}

export interface GptFunctionTool {
  type: "function";
  function: { name: string; description: string; parameters: Schema; strict: true };
}
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

export const gptTool = (tool: PlanTool): GptFunctionTool => ({
  type: "function",
  function: { name: tool.name, description: tool.description, parameters: gptSchema(tool.schema), strict: true },
});

/** The answer's first choice's message and why it ended; anything else is an answer that can't be read. */
function readChoice(completion: unknown): { message: Schema; finish: unknown } {
  const choice = isSchema(completion) && Array.isArray(completion.choices) ? completion.choices[0] : undefined;
  if (!isSchema(choice) || !isSchema(choice.message)) throw new AnswerError("failed", "GPT's answer couldn't be read.");
  return { message: choice.message, finish: choice.finish_reason };
}

/** The reply's words and calls; a refusal, a filtered or a cut-off reply is a failure, never guessed at. */
export function readGptReply(completion: unknown): { text: string; calls: ModelCall[]; message: ChatMessage } {
  const { message, finish } = readChoice(completion);
  if (typeof message.refusal === "string" && message.refusal !== "") throw new AnswerError("refused", "GPT declined this request.");
  if (finish === "content_filter") throw new AnswerError("refused", "GPT declined this request.");
  if (finish === "length") throw new AnswerError("failed", "GPT's answer was cut off.");
  const calls: ModelCall[] = [];
  const sent: ToolCall[] = [];
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    if (!isSchema(call) || call.type !== "function" || typeof call.id !== "string" || !isSchema(call.function)) continue;
    const { name, arguments: args } = call.function;
    if (typeof name !== "string" || typeof args !== "string") continue;
    let input: unknown = null;
    try {
      input = withoutNulls(JSON.parse(args));
    } catch {
      // Arguments that don't parse: the step can't run, and says so (plan.ts).
    }
    calls.push({ id: call.id, name, input });
    sent.push({ id: call.id, type: "function", function: { name, arguments: args } });
  }
  const content = typeof message.content === "string" ? message.content : null;
  return { text: (content ?? "").trim(), calls, message: { role: "assistant", content, ...(sent.length > 0 ? { tool_calls: sent } : {}) } };
}

/** The messages for a turn: how the last calls went, then the words. */
export function gptMessages(history: readonly ChatMessage[], turn: Turn): ChatMessage[] {
  return [
    ...(history.length === 0 ? [{ role: "developer" as const, content: SYSTEM_PROMPT }] : history),
    ...turn.results.map((result) => ({ role: "tool" as const, tool_call_id: result.id, content: result.error ? `Error: ${result.text}` : result.text })),
    { role: "user" as const, content: turn.text },
  ];
}

/** What went wrong with a request, as the launcher says it; never with the key. */
export function gptFailure(error: unknown, model: string | null = null): AnswerError {
  if (error instanceof AnswerError) return error;
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) return new AnswerError("no-key", "OpenAI didn't accept the key.");
    if (error.status === 404 && model) return new AnswerError("no-model", `The model “${model}” isn't available to your key.`);
    if (error.status === 429)
      return error.code === "insufficient_quota"
        ? new AnswerError("failed", "Your OpenAI account has no credit left.")
        : new AnswerError("no-answer", "GPT is busy; try again in a moment.");
    if (error.status >= 500) return new AnswerError("no-answer", "GPT is busy; try again in a moment.");
    return new AnswerError("failed", errorWords(error.body) || `OpenAI answered ${error.status}.`);
  }
  if (error instanceof UnreadableError) return new AnswerError("failed", "GPT's answer couldn't be read.");
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

/** One request to api.openai.com: the key in the header, the fixed base URL, and nothing from the session. */
function call(key: string, path: string, body: unknown, options: Pick<GptOptions, "fetch" | "maxRetries">, signal?: AbortSignal): Promise<unknown> {
  return requestJson({
    url: `${BASE_URL}${path}`,
    headers: { authorization: `Bearer ${key}` },
    ...(body === undefined ? {} : { body }),
    ...(signal ? { signal } : {}),
    timeoutMs: TIMEOUT_MS,
    retries: options.maxRetries ?? 1,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/** The chat models the key lists, the most capable first. */
export async function listGptModels(key: string, options: Pick<GptOptions, "fetch" | "maxRetries"> = {}, signal?: AbortSignal): Promise<string[]> {
  const listed = await call(key, "/models", undefined, options, signal);
  const data = isSchema(listed) && Array.isArray(listed.data) ? listed.data : [];
  return rankGptModels(data.flatMap((model) => (isSchema(model) && typeof model.id === "string" ? [model.id] : [])));
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
        const messages = gptMessages(history as readonly ChatMessage[], turn);
        const completion = await call(
          key,
          "/chat/completions",
          {
            model,
            messages,
            ...(tools.length > 0 ? { tools: tools.map(gptTool), tool_choice: "auto" } : {}),
            max_completion_tokens: MAX_TOKENS,
            store: false,
          },
          options,
          signal,
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
