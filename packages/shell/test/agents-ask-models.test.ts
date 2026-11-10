import { expect, test } from "bun:test";
import { AnswerError } from "../src/agents/ask/answerer.ts";
import { ANTHROPIC_HOST, claudeAnswerer, echoed, FALLBACK_BETA, type Fetch, readReply } from "../src/agents/ask/claude.ts";
import { strictSchema } from "../src/agents/ask/strict.ts";
import { signal, TOOLS } from "./support/agents-ask-models.ts";

const KEY = "sk-test-not-a-real-key";

/** A fetch that records what was asked and answers `body` with `status`. */
function recording(body: unknown, status = 200): Fetch & { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as Fetch & { calls: typeof calls };
  send.calls = calls;
  return send;
}

const message = (content: unknown[], stopReason = "end_turn") => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});

const headersOf = (init: RequestInit) => new Headers(init.headers);

test("Claude: one SDK request to api.anthropic.com, the key in its header only, Opus 5.5 with low effort, strict tools and fallbacks", async () => {
  const send = recording(
    message(
      [
        { type: "thinking", thinking: "", signature: "s" },
        { type: "tool_use", id: "c1", name: "lock_screen", input: {} },
      ],
      "tool_use",
    ),
  );
  const claude = claudeAnswerer({ key: async () => KEY, fetch: send });
  const { reply, history } = await claude.turn([], { text: "lock up", results: [] }, TOOLS, signal());
  expect(reply.calls).toEqual([{ id: "c1", name: "lock_screen", input: {} }]);
  expect(send.calls).toHaveLength(1);
  const [{ url, init }] = send.calls as [{ url: string; init: RequestInit }];
  expect(new URL(url).host).toBe(ANTHROPIC_HOST);
  expect(new URL(url).pathname).toBe("/v1/messages");
  const headers = headersOf(init);
  // The SDK sends the key as a bearer credential; it is in that one header and no other.
  expect([...headers].filter(([, value]) => value.includes(KEY))).toEqual([["authorization", `Bearer ${KEY}`]]);
  expect(headers.get("anthropic-beta")).toContain(FALLBACK_BETA);
  const body = JSON.parse(String(init.body));
  expect(JSON.stringify(body)).not.toContain(KEY);
  expect(body.model).toBe("claude-opus-5-5");
  expect(body.output_config).toEqual({ effort: "low" });
  expect(body.fallbacks).toBe("default");
  expect(body.tool_choice).toEqual({ type: "auto" });
  // Thinking is left as Opus 5.5 has it: never disabled, never a budget.
  expect(body.thinking).toBeUndefined();
  expect(body.betas).toBeUndefined();
  expect(body.tools).toEqual([{ name: "lock_screen", description: "Lock the screen", input_schema: TOOLS[0]?.schema, strict: true }]);
  expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "lock up" }] }]);
  expect(body.temperature).toBeUndefined();
  // The assistant's content goes back as it came (thinking included), for the next turn.
  expect(history.at(-1)).toEqual({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "tool_use", id: "c1", name: "lock_screen", input: {} },
    ],
  });
});

test("Claude: ANTHROPIC_BASE_URL in the session doesn't move the key elsewhere", async () => {
  const before = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = "https://example.com";
  try {
    const send = recording(message([{ type: "text", text: "Done." }]));
    await claudeAnswerer({ key: async () => KEY, fetch: send }).turn([], { text: "x", results: [] }, TOOLS, signal());
    expect(new URL(send.calls[0]?.url ?? "").host).toBe(ANTHROPIC_HOST);
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = before;
  }
});

test("Claude: a follow-up reports how each call went first", async () => {
  const send = recording(message([{ type: "text", text: "Done." }]));
  const claude = claudeAnswerer({ key: async () => KEY, fetch: send });
  await claude.turn(
    [{ role: "user", content: "x" }],
    {
      text: "and again",
      results: [
        { id: "c1", text: "Locked.", error: false },
        { id: "c2", text: "Not run.", error: true },
      ],
    },
    TOOLS,
    signal(),
  );
  const body = JSON.parse(String(send.calls[0]?.init.body));
  expect(body.messages.at(-1)).toEqual({
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "c1", content: "Locked." },
      { type: "tool_result", tool_use_id: "c2", content: "Not run.", is_error: true },
      { type: "text", text: "and again" },
    ],
  });
});

test("Claude: no key sends nothing; a refused key, an outage and a bad request say so (typed SDK errors), without the key", async () => {
  const none = recording({});
  await expect(claudeAnswerer({ key: async () => null, fetch: none }).turn([], { text: "x", results: [] }, TOOLS, signal())).rejects.toMatchObject({
    failure: "no-key",
  });
  expect(none.calls).toEqual([]);
  for (const [status, failure] of [
    [401, "no-key"],
    [403, "no-key"],
    [429, "no-answer"],
    [529, "no-answer"],
    [400, "failed"],
  ] as const) {
    const error = await claudeAnswerer({
      key: async () => KEY,
      maxRetries: 0,
      fetch: recording({ type: "error", error: { type: "x", message: "bad things" } }, status),
    })
      .turn([], { text: "x", results: [] }, TOOLS, signal())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnswerError);
    expect((error as AnswerError).failure).toBe(failure);
    expect((error as AnswerError).message).not.toContain(KEY);
    if (status === 400) expect((error as AnswerError).message).toBe("bad things");
  }
  const offline: Fetch = async () => {
    throw new TypeError("network down");
  };
  await expect(
    claudeAnswerer({ key: async () => KEY, fetch: offline, maxRetries: 0 }).turn([], { text: "x", results: [] }, TOOLS, signal()),
  ).rejects.toMatchObject({
    failure: "no-answer",
  });
});

test("Claude: a refusal is read before the content; a cut-off call is never a plan", async () => {
  const refused = recording(message([{ type: "tool_use", id: "c1", name: "lock_screen", input: {} }], "refusal"));
  await expect(claudeAnswerer({ key: async () => KEY, fetch: refused }).turn([], { text: "x", results: [] }, TOOLS, signal())).rejects.toMatchObject({
    failure: "refused",
  });
  expect(() => readReply({ content: [], stop_reason: "refusal" })).toThrow("Claude declined this request.");
  expect(() => readReply({ content: [{ type: "tool_use", id: "c1", name: "lock_screen", input: {} }], stop_reason: "max_tokens" })).toThrow(
    "Claude's answer was cut off.",
  );
});

test("Claude: after a fallback, the plan is the serving model's, and the declined model's calls aren't sent back", () => {
  const content = [
    { type: "thinking" as const, thinking: "", signature: "a" },
    { type: "tool_use" as const, id: "old", name: "lock_screen", input: {}, caller: { type: "direct" as const } },
    { type: "text" as const, text: "Partly ", citations: null },
    { type: "fallback" as const, from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } },
    { type: "tool_use" as const, id: "new", name: "lock_screen", input: {}, caller: { type: "direct" as const } },
  ] as unknown as Parameters<typeof readReply>[0]["content"];
  expect(readReply({ content, stop_reason: "tool_use" }).calls.map((call) => call.id)).toEqual(["new"]);
  expect(echoed(content).map((block) => block.type)).toEqual(["text", "fallback", "tool_use"]);
});

test("strict schemas: objects closed, bounds dropped (the action's check still holds them), oneOf as anyOf", () => {
  expect(
    strictSchema({
      type: "object",
      properties: {
        level: { type: "number", minimum: 0, maximum: 100, description: "Percent" },
        name: { type: "string", minLength: 1, maxLength: 64, pattern: "^a", format: "email" },
        value: { oneOf: [{ type: "boolean" }, { type: "string", enum: ["a", "b"] }] },
        nested: { type: "object", properties: { x: { type: "string", format: "color" } } },
        list: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
      },
      required: ["level"],
    }),
  ).toEqual({
    type: "object",
    properties: {
      level: { type: "number", description: "Percent" },
      name: { type: "string", format: "email" },
      value: { anyOf: [{ type: "boolean" }, { type: "string", enum: ["a", "b"] }] },
      nested: { type: "object", properties: { x: { type: "string" } }, additionalProperties: false },
      list: { type: "array", items: { type: "string" } },
    },
    required: ["level"],
    additionalProperties: false,
  });
  expect(strictSchema(null)).toEqual({});
});
