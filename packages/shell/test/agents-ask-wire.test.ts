/**
 * The API answerers' wire: http.ts's tries and timeouts, the request and
 * reply shapes of claude.ts and gpt.ts against fixtures (test/fixtures/ask/,
 * written from the providers' API references: no live call, no real key).
 * The real `fetch` path against a local stub server is in
 * agents-ask-stub.test.ts; that no AI library loads at the shell's start is
 * H16's check (scripts/boot-weight.ts).
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { answerFailure, echoed, readMessage, readReply } from "../src/agents/ask/lib/claude.ts";
import { gptFailure, readGptReply } from "../src/agents/ask/lib/gpt.ts";
import { HttpError, NoReachError, requestJson, UnreadableError } from "../src/agents/ask/lib/http.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(import.meta.dir, "fixtures/ask", `${name}.json`), "utf8"));

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
