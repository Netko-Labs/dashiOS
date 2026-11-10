/**
 * The API answerers over the real `fetch`, against a local stub server on
 * 127.0.0.1: what is sent, to which host, with the key where it belongs, and
 * how each provider's errors are said. No live call, no real key.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AnswerError, type PlanTool } from "../src/agents/ask/answerer.ts";
import { ANTHROPIC_VERSION, claudeAnswerer, FALLBACK_BETA } from "../src/agents/ask/claude.ts";
import { gptAnswerer, listGptModels } from "../src/agents/ask/gpt.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(import.meta.dir, "fixtures/ask", `${name}.json`), "utf8"));
const KEY = "sk-test-not-a-real-key";
const TOOLS: PlanTool[] = [
  { name: "lock_screen", description: "Lock the screen", schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
];
const signal = () => new AbortController().signal;
const turn = { text: "lock up", results: [] };

// --- A local stub server: the real fetch, the real wire ----------------------

interface Seen {
  method: string;
  path: string;
  headers: Headers;
  body: Record<string, unknown> | null;
}
const seen: Seen[] = [];
let answers: Array<() => Response> = [];
let server: ReturnType<typeof Bun.serve>;
let hosts: string[] = [];

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const text = await request.text();
      seen.push({ method: request.method, path: new URL(request.url).pathname, headers: request.headers, body: text ? JSON.parse(text) : null });
      return (answers.shift() ?? (() => new Response("no answer left", { status: 500 })))();
    },
  });
});
afterAll(() => server.stop(true));

/** A fetch that sends what is meant for a provider to the stub, remembering which host it was meant for. */
const toStub = async (url: string, init: RequestInit): Promise<Response> => {
  const meant = new URL(url);
  hosts.push(meant.host);
  return fetch(`http://127.0.0.1:${server.port}${meant.pathname}`, init);
};
const reset = (...next: Array<() => Response>) => {
  seen.length = 0;
  hosts = [];
  answers = next;
};
const json = (body: unknown, init?: ResponseInit) => () => Response.json(body, init);

test("stub: Claude over real fetch: POST /v1/messages to api.anthropic.com, the key in Authorization only, a busy answer tried again", async () => {
  reset(json(fixture("claude-error-overloaded"), { status: 529, headers: { "retry-after-ms": "1" } }), json(fixture("claude-tool-use")));
  const claude = claudeAnswerer({ key: async () => KEY, fetch: toStub });
  const { reply, history } = await claude.turn([], turn, TOOLS, signal());
  expect(reply.calls.map((call) => call.name)).toEqual(["lock_screen", "set_setting"]);
  expect(hosts).toEqual(["api.anthropic.com", "api.anthropic.com"]);
  expect(seen.map((each) => [each.method, each.path])).toEqual([
    ["POST", "/v1/messages"],
    ["POST", "/v1/messages"],
  ]);
  const { headers, body } = seen[1] as Seen;
  expect([...headers].filter(([, value]) => value.includes(KEY))).toEqual([["authorization", `Bearer ${KEY}`]]);
  expect(headers.get("anthropic-version")).toBe(ANTHROPIC_VERSION);
  expect(headers.get("anthropic-beta")).toBe(FALLBACK_BETA);
  expect(headers.get("content-type")).toBe("application/json");
  expect(headers.get("x-api-key")).toBeNull();
  expect(JSON.stringify(body)).not.toContain(KEY);
  expect(body).toMatchObject({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "low" },
    fallbacks: "default",
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: [{ type: "text", text: "lock up" }] }],
  });
  // Both tries are the same request.
  expect(seen[0]?.body).toEqual(body);
  // The next turn is sent what came back, thinking included, after the person's first words.
  expect(history).toHaveLength(2);
  expect(history[1]).toMatchObject({ role: "assistant", content: (fixture("claude-tool-use") as { content: unknown }).content });
});

test("stub: Claude's key refused, and a refusal, are said in Dashi's words", async () => {
  reset(json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 }));
  const refused = await claudeAnswerer({ key: async () => KEY, fetch: toStub, maxRetries: 0 })
    .turn([], turn, TOOLS, signal())
    .catch((caught: unknown) => caught);
  expect(refused).toBeInstanceOf(AnswerError);
  expect(refused).toMatchObject({ failure: "no-key", message: "Anthropic didn't accept the key." });
  reset(json(fixture("claude-refusal")));
  await expect(claudeAnswerer({ key: async () => KEY, fetch: toStub }).turn([], turn, TOOLS, signal())).rejects.toMatchObject({ failure: "refused" });
  reset();
  await expect(claudeAnswerer({ key: async () => null, fetch: toStub }).turn([], turn, TOOLS, signal())).rejects.toMatchObject({
    failure: "no-key",
    message: "Add your Anthropic key in Settings › Agents.",
  });
  expect(seen).toEqual([]);
});

test("stub: GPT over real fetch: GET /v1/models once, then POST /v1/chat/completions, both to api.openai.com with a bearer key", async () => {
  reset(json(fixture("openai-models")), json(fixture("openai-completion-tools")));
  const gpt = gptAnswerer({ key: async () => KEY, model: () => null, fetch: toStub });
  const { reply } = await gpt.turn([], turn, TOOLS, signal());
  expect(reply.calls.map((call) => call.name)).toEqual(["set_setting", "set_volume"]);
  expect(hosts).toEqual(["api.openai.com", "api.openai.com"]);
  expect(seen.map((each) => [each.method, each.path])).toEqual([
    ["GET", "/v1/models"],
    ["POST", "/v1/chat/completions"],
  ]);
  expect(seen.every((each) => each.headers.get("authorization") === `Bearer ${KEY}`)).toBe(true);
  expect(seen.every((each) => ![...each.headers.keys()].some((name) => ["openai-organization", "openai-project"].includes(name)))).toBe(true);
  expect(seen[1]?.body).toMatchObject({
    model: "gpt-5.1",
    max_completion_tokens: 16000,
    store: false,
    tool_choice: "auto",
    messages: [
      { role: "developer", content: expect.any(String) },
      { role: "user", content: "lock up" },
    ],
    tools: [{ type: "function", function: { name: "lock_screen", strict: true } }],
  });
  expect(JSON.stringify(seen[1]?.body)).not.toContain(KEY);
});

test("stub: GPT's models are the chat ones, best first; a quota error, an unknown model and an outage say so", async () => {
  reset(json(fixture("openai-models")));
  expect(await listGptModels(KEY, { fetch: toStub })).toEqual(["gpt-5.1", "gpt-4o"]);
  reset(json(fixture("openai-error-quota"), { status: 429, headers: { "x-should-retry": "false" } }));
  await expect(gptAnswerer({ key: async () => KEY, model: () => "gpt-5.1", fetch: toStub }).turn([], turn, TOOLS, signal())).rejects.toMatchObject({
    failure: "failed",
    message: "Your OpenAI account has no credit left.",
  });
  reset(json(fixture("openai-error-model"), { status: 404 }));
  await expect(gptAnswerer({ key: async () => KEY, model: () => "gpt-9", fetch: toStub }).turn([], turn, TOOLS, signal())).rejects.toMatchObject({
    failure: "no-model",
  });
  reset(json({}, { status: 503, headers: { "retry-after-ms": "1" } }), json({}, { status: 503 }));
  await expect(gptAnswerer({ key: async () => KEY, model: () => "gpt-5.1", fetch: toStub }).turn([], turn, TOOLS, signal())).rejects.toMatchObject({
    failure: "no-answer",
  });
  expect(seen).toHaveLength(2);
});

test("stub: a stopped turn stops the request, and says nothing of its own", async () => {
  const stop = new AbortController();
  answers = [];
  const slow = (url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      void url;
      // Stopped once the request is under way: no waiting on a clock.
      queueMicrotask(() => stop.abort());
    });
  const pending = claudeAnswerer({ key: async () => KEY, fetch: slow }).turn([], turn, TOOLS, stop.signal);
  await expect(pending).rejects.not.toBeInstanceOf(AnswerError);
});
