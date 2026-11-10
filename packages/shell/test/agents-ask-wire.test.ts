/**
 * The API answerers' wire: http.ts's tries and timeouts, the request and
 * reply shapes of claude.ts and gpt.ts against fixtures (test/fixtures/ask/,
 * written from the providers' API references: no live call, no real key),
 * a local stub server for the real `fetch` path, and the proof that no AI
 * library is in the shell's boot.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AnswerError, type PlanTool } from "../src/agents/ask/answerer.ts";
import { ANTHROPIC_VERSION, answerFailure, claudeAnswerer, echoed, FALLBACK_BETA, readMessage, readReply } from "../src/agents/ask/claude.ts";
import { gptAnswerer, gptFailure, listGptModels, readGptReply } from "../src/agents/ask/gpt.ts";
import { HttpError, NoReachError, requestJson, UnreadableError } from "../src/agents/ask/http.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(import.meta.dir, "fixtures/ask", `${name}.json`), "utf8"));
const KEY = "sk-test-not-a-real-key";
const TOOLS: PlanTool[] = [
  { name: "lock_screen", description: "Lock the screen", schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
];
const signal = () => new AbortController().signal;
const turn = { text: "lock up", results: [] };

// --- http.ts ---------------------------------------------------------------

/** A fetch that answers from a list, one per try, and a `wait` that records the pauses instead of sleeping. */
function scripted(answers: Array<Response | Error>) {
  const tries: Array<{ url: string; init: RequestInit }> = [];
  const waits: number[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    tries.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return next;
  };
  const wait = async (ms: number) => {
    waits.push(ms);
  };
  return { fetch, wait, tries, waits };
}
const base = { url: "https://example.test/x", headers: { authorization: "Bearer k" }, timeoutMs: 1000 };

test("http: a POST carries JSON and the headers it was given, and a GET has no body", async () => {
  const sent = scripted([Response.json({ ok: 1 }), Response.json({ ok: 2 })]);
  expect(await requestJson({ ...base, body: { a: 1 }, retries: 0, fetch: sent.fetch })).toEqual({ ok: 1 });
  expect(await requestJson({ ...base, retries: 0, fetch: sent.fetch })).toEqual({ ok: 2 });
  const [post, get] = sent.tries as [(typeof sent.tries)[0], (typeof sent.tries)[0]];
  expect(post.init.method).toBe("POST");
  expect(post.init.body).toBe('{"a":1}');
  expect(new Headers(post.init.headers).get("content-type")).toBe("application/json");
  expect(new Headers(post.init.headers).get("authorization")).toBe("Bearer k");
  expect(get.init.method).toBe("GET");
  expect(get.init.body).toBeUndefined();
  expect(new Headers(get.init.headers).get("content-type")).toBeNull();
});

test("http: a rate limit, a timeout, a conflict and a server error are tried again; a bad request is not", async () => {
  for (const status of [408, 409, 429, 500, 503, 529]) {
    const sent = scripted([new Response("{}", { status }), Response.json({ ok: true })]);
    expect(await requestJson({ ...base, body: {}, retries: 1, fetch: sent.fetch, wait: sent.wait })).toEqual({ ok: true });
    expect(sent.tries).toHaveLength(2);
    expect(sent.waits).toHaveLength(1);
  }
  const bad = scripted([new Response('{"error":{"message":"no"}}', { status: 400 }), Response.json({ ok: true })]);
  await expect(requestJson({ ...base, body: {}, retries: 1, fetch: bad.fetch, wait: bad.wait })).rejects.toMatchObject({ status: 400 });
  expect(bad.tries).toHaveLength(1);
});

test("http: the provider's x-should-retry wins, and Retry-After is obeyed within reason", async () => {
  const no = scripted([new Response("{}", { status: 503, headers: { "x-should-retry": "false" } }), Response.json({})]);
  await expect(requestJson({ ...base, body: {}, retries: 1, fetch: no.fetch, wait: no.wait })).rejects.toBeInstanceOf(HttpError);
  expect(no.tries).toHaveLength(1);
  const yes = scripted([new Response("{}", { status: 400, headers: { "x-should-retry": "true" } }), Response.json({})]);
  await requestJson({ ...base, body: {}, retries: 1, fetch: yes.fetch, wait: yes.wait });
  expect(yes.tries).toHaveLength(2);

  const after = scripted([
    new Response("{}", { status: 429, headers: { "retry-after-ms": "250" } }),
    new Response("{}", { status: 429, headers: { "retry-after": "2" } }),
    new Response("{}", { status: 429, headers: { "retry-after": "3600" } }),
    Response.json({}),
  ]);
  await requestJson({ ...base, body: {}, retries: 3, fetch: after.fetch, wait: after.wait });
  expect(after.waits.slice(0, 2)).toEqual([250, 2000]);
  // An hour is too long to sit for: back off by the usual steps instead (0.5 s, 1 s, 2 s, at most 25% less).
  expect(after.waits[2]).toBeLessThanOrEqual(2000);
  expect(after.waits[2]).toBeGreaterThanOrEqual(1500);
});

test("http: the tries run out, and the last answer is the error; a dropped connection is a NoReachError", async () => {
  const out = scripted([new Response('{"error":{"message":"busy"}}', { status: 529 }), new Response('{"error":{"message":"still busy"}}', { status: 529 })]);
  const error = await requestJson({ ...base, body: {}, retries: 1, fetch: out.fetch, wait: out.wait }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(529);
  expect((error as HttpError).body).toEqual({ error: { message: "still busy" } });

  const down = scripted([new TypeError("network down"), new TypeError("network down")]);
  const dropped = await requestJson({ ...base, body: {}, retries: 1, fetch: down.fetch, wait: down.wait }).catch((caught: unknown) => caught);
  expect(dropped).toBeInstanceOf(NoReachError);
  expect(down.tries).toHaveLength(2);
});

test("http: a try that takes too long ends, and tries again; the caller's own abort is never retried or renamed", async () => {
  let tries = 0;
  const hang = (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      tries++;
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  const timedOut = await requestJson({ ...base, body: {}, timeoutMs: 20, retries: 1, fetch: hang, wait: async () => {} }).catch((caught: unknown) => caught);
  expect(timedOut).toBeInstanceOf(NoReachError);
  expect((timedOut as NoReachError).timedOut).toBe(true);
  expect(tries).toBe(2);

  const stop = new AbortController();
  tries = 0;
  const pending = requestJson({ ...base, body: {}, timeoutMs: 5000, retries: 3, signal: stop.signal, fetch: hang, wait: async () => {} }).catch(
    (caught: unknown) => caught,
  );
  stop.abort();
  const aborted = await pending;
  expect(aborted).not.toBeInstanceOf(NoReachError);
  expect(tries).toBe(1);
});

test("http: an answer that isn't JSON is unreadable, and an error body that isn't JSON stays text", async () => {
  await expect(requestJson({ ...base, body: {}, retries: 0, fetch: scripted([new Response("<html>")]).fetch })).rejects.toBeInstanceOf(UnreadableError);
  const error = await requestJson({ ...base, body: {}, retries: 0, fetch: scripted([new Response("Bad gateway", { status: 502 })]).fetch }).catch(
    (caught: unknown) => caught,
  );
  expect((error as HttpError).body).toBe("Bad gateway");
});

// --- Claude, from fixtures ---------------------------------------------------

test("Claude: a tool_use reply is the plan; thinking goes back with it, and the text is kept", () => {
  const message = readMessage(fixture("claude-tool-use"));
  expect(readReply(message)).toEqual({
    text: "Locking the screen and turning on dark mode.",
    calls: [
      { id: "toolu_01A09q90qw90lq917835lq9", name: "lock_screen", input: {} },
      { id: "toolu_01B1xk2s3dd44e5ff6g7h8j", name: "set_setting", input: { name: "dark_mode", value: true } },
    ],
  });
  expect(echoed(message.content)).toEqual([...message.content]);
});

test("Claude: after a fallback, only the serving model's calls are the plan, and the declined model's aren't sent back", () => {
  const message = readMessage(fixture("claude-fallback"));
  expect(readReply(message).calls.map((call) => call.id)).toEqual(["toolu_served"]);
  expect(echoed(message.content).map((block) => block.type)).toEqual(["fallback", "thinking", "text", "tool_use"]);
});

test("Claude: a refusal is a refusal even with nothing in it; replies that aren't messages can't be read", () => {
  expect(() => readReply(readMessage(fixture("claude-refusal")))).toThrow("Claude declined this request.");
  for (const body of [null, "x", [], {}, { content: "text" }, { content: [{ nope: 1 }] }, { content: [null] }])
    expect(() => readMessage(body)).toThrow("Claude's answer couldn't be read.");
  // A block that lacks the fields a call needs is left out, never half-read.
  const odd = readMessage({ content: [{ type: "tool_use", name: "lock_screen" }, { type: "text" }, { type: "server_tool_use" }], stop_reason: "end_turn" });
  expect(readReply(odd)).toEqual({ text: "", calls: [] });
});

test("Claude: error bodies as the launcher says them", () => {
  const overloaded = new HttpError(529, fixture("claude-error-overloaded"));
  expect(answerFailure(overloaded)).toMatchObject({ failure: "no-answer", message: "Claude is busy; try again in a moment." });
  const invalid = answerFailure(new HttpError(400, fixture("claude-error-invalid-request")));
  expect(invalid).toMatchObject({ failure: "failed", message: "tools.0.strict: Extra inputs are not permitted" });
  expect(answerFailure(new HttpError(404, "<html>"))).toMatchObject({ failure: "failed", message: "Claude answered 404." });
  expect(answerFailure(new HttpError(401, {}))).toMatchObject({ failure: "no-key" });
  expect(answerFailure(new NoReachError(true))).toMatchObject({ failure: "no-answer", message: "Claude didn't answer." });
  expect(answerFailure(new UnreadableError())).toMatchObject({ failure: "failed" });
  expect(answerFailure(new TypeError("boom"))).toMatchObject({ failure: "no-answer" });
});

// --- GPT, from fixtures ------------------------------------------------------

test("GPT: tool calls are the plan, nulls dropped; what goes back is the calls as they came", () => {
  const reply = readGptReply(fixture("openai-completion-tools"));
  expect(reply.text).toBe("");
  expect(reply.calls).toEqual([
    { id: "call_Zx81", name: "set_setting", input: { name: "dark_mode", value: true } },
    { id: "call_Zx82", name: "set_volume", input: { target: "output", muted: true } },
  ]);
  expect(reply.message).toEqual({
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "call_Zx81", type: "function", function: { name: "set_setting", arguments: '{"name":"dark_mode","value":true}' } },
      { id: "call_Zx82", type: "function", function: { name: "set_volume", arguments: '{"target":"output","level":null,"muted":true}' } },
    ],
  });
});

test("GPT: a refusal is never a plan; an answer that isn't a completion can't be read", () => {
  expect(() => readGptReply(fixture("openai-completion-refusal"))).toThrow("GPT declined this request.");
  for (const body of [null, "x", {}, { choices: [] }, { choices: [{}] }, { choices: [{ message: "hi" }] }])
    expect(() => readGptReply(body)).toThrow("GPT's answer couldn't be read.");
  // Calls that are not functions, or lack their fields, are left out.
  const odd = readGptReply({
    choices: [{ finish_reason: "stop", message: { content: " Hi. ", tool_calls: [{ id: "c", type: "custom" }, { type: "function", function: {} }, null] } }],
  });
  expect(odd).toMatchObject({ text: "Hi.", calls: [], message: { role: "assistant", content: " Hi. " } });
});

test("GPT: error bodies as the launcher says them", () => {
  expect(gptFailure(new HttpError(429, fixture("openai-error-quota")))).toMatchObject({
    failure: "failed",
    message: "Your OpenAI account has no credit left.",
  });
  expect(gptFailure(new HttpError(429, { error: { message: "slow down", code: "rate_limit_exceeded" } }))).toMatchObject({ failure: "no-answer" });
  expect(gptFailure(new HttpError(404, fixture("openai-error-model")), "gpt-9")).toMatchObject({
    failure: "no-model",
    message: "The model “gpt-9” isn't available to your key.",
  });
  expect(gptFailure(new HttpError(404, fixture("openai-error-model")))).toMatchObject({ failure: "failed" });
  expect(gptFailure(new HttpError(503, ""))).toMatchObject({ failure: "no-answer" });
  expect(gptFailure(new HttpError(403, {}))).toMatchObject({ failure: "no-key" });
  expect(gptFailure(new NoReachError(false))).toMatchObject({ failure: "no-answer", message: "GPT didn't answer." });
});

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
    });
  const pending = claudeAnswerer({ key: async () => KEY, fetch: slow }).turn([], turn, TOOLS, stop.signal);
  setTimeout(() => stop.abort(), 10);
  await expect(pending).rejects.not.toBeInstanceOf(AnswerError);
});

// --- The boot ----------------------------------------------------------------

test("boot: no AI library is in the shell's startup graph, and none is a dependency", async () => {
  const root = join(import.meta.dir, "..");
  const built = await Bun.build({ entrypoints: [join(root, "src/main.tsx")], target: "bun", metafile: true });
  expect(built.success).toBe(true);
  const inputs = Object.keys(built.metafile?.inputs ?? {});
  expect(inputs.length).toBeGreaterThan(500);
  // The answerers are in it (they're ours and small); the libraries are not.
  expect(inputs.some((path) => path.endsWith("agents/ask/claude.ts"))).toBe(true);
  const libraries = /node_modules\/(openai|@anthropic-ai|ai|@ai-sdk|@opentelemetry|standardwebhooks)\//;
  expect(inputs.filter((path) => libraries.test(path))).toEqual([]);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  expect(Object.keys(manifest.dependencies ?? {}).filter((name) => /^(openai|ai|@ai-sdk\/.*|@anthropic-ai\/.*)$/.test(name))).toEqual([]);
}, 60_000);
