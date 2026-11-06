import { expect, test } from "bun:test";
import { AnswerError, type PlanTool } from "../src/agents/ask/answerer.ts";
import { ANTHROPIC_HOST, claudeAnswerer, echoed, FALLBACK_BETA, type Fetch, readReply } from "../src/agents/ask/claude.ts";
import { ANTHROPIC_TOKEN, keyPlace, modelKeys, vaultTokenSource } from "../src/agents/ask/keys.ts";
import { isModelName, LOCAL_URL, localAnswerer, localModels, readLocalReply } from "../src/agents/ask/local.ts";
import { strictSchema } from "../src/agents/ask/strict.ts";

const TOOLS: PlanTool[] = [
  { name: "lock_screen", description: "Lock the screen", schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
];
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

const signal = () => new AbortController().signal;

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

test("local: the loopback only, the model named or the first installed, and tool calls read with ids of their own", async () => {
  expect(new URL(LOCAL_URL).hostname).toBe("127.0.0.1");
  const calls: string[] = [];
  const send: Fetch = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen3:8b" }, { name: "bad name!" }] });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("qwen3:8b");
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe("system");
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "lock_screen", description: "Lock the screen", parameters: TOOLS[0]?.schema } });
    return Response.json({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "lock_screen", arguments: {} } }] } });
  };
  const local = localAnswerer({ model: () => null, fetch: send });
  const { reply } = await local.turn([], { text: "lock up", results: [] }, TOOLS, signal());
  expect(reply.calls).toEqual([{ id: "local-1-0", name: "lock_screen", input: {} }]);
  expect(calls.every((url) => url.startsWith(LOCAL_URL))).toBe(true);
  expect(await localModels(send)).toEqual(["qwen3:8b"]);
  expect(readLocalReply({ message: { content: " Sure. " } }, 2)).toMatchObject({ text: "Sure.", calls: [] });
});

test("local: nothing running, nothing installed", async () => {
  const down: Fetch = async () => {
    throw new TypeError("connection refused");
  };
  expect(await localModels(down)).toBeNull();
  await expect(localAnswerer({ model: () => null, fetch: down }).turn([], { text: "x", results: [] }, TOOLS, signal())).rejects.toMatchObject({
    failure: "no-answer",
  });
  const empty: Fetch = async () => Response.json({ models: [] });
  await expect(localAnswerer({ model: () => null, fetch: empty }).turn([], { text: "x", results: [] }, TOOLS, signal())).rejects.toMatchObject({
    failure: "no-model",
  });
  expect(isModelName("llama3.2:3b")).toBe(true);
  expect(isModelName("../../etc")).toBe(false);
});

test("Claude's key: the vault's token item for api.anthropic.com first, else ANTHROPIC_API_KEY, else none", async () => {
  const asked: Array<[string, string]> = [];
  const handed: Uint8Array[] = [];
  const tokens = {
    forHost: async (name: string, host: string) => {
      asked.push([name, host]);
      if (name !== ANTHROPIC_TOKEN || host !== ANTHROPIC_HOST) throw new Error("not for that host");
      const token = new TextEncoder().encode("from-vault");
      handed.push(token);
      return { token, headers: ["x-api-key: {}", "Authorization: Bearer {}"] };
    },
    list: async () => [{ id: 1, name: ANTHROPIC_TOKEN, hosts: [ANTHROPIC_HOST], headers: ["x-api-key: {}"], lastUsed: null }],
  };
  const keys = modelKeys(vaultTokenSource(tokens), { ANTHROPIC_API_KEY: "from-env" });
  expect(await keys.anthropic()).toEqual({ key: "from-vault", place: "vault" });
  expect(asked).toEqual([["anthropic", "api.anthropic.com"]]);
  // The vault's bytes are wiped once read.
  expect(handed[0]?.every((byte) => byte === 0)).toBe(true);
  // Settings learns where the key is without the vault handing it out.
  expect(await keyPlace(keys)).toBe("vault");
  expect(asked).toHaveLength(1);

  // No such item (or it lists other hosts), or a locked vault: the session's key.
  const other = {
    forHost: async () => Promise.reject(new Error("no such token")),
    list: async () => [{ id: 2, name: ANTHROPIC_TOKEN, hosts: ["api.example.com"], headers: ["x-api-key: {}"], lastUsed: null }],
  };
  expect(await modelKeys(vaultTokenSource(other), { ANTHROPIC_API_KEY: " from-env " }).anthropic()).toEqual({ key: "from-env", place: "environment" });
  expect(await keyPlace(modelKeys(vaultTokenSource(other), { ANTHROPIC_API_KEY: "from-env" }))).toBe("environment");
  expect(await modelKeys(null, { ANTHROPIC_API_KEY: " from-env " }).anthropic()).toEqual({ key: "from-env", place: "environment" });
  const locked = { forHost: async () => Promise.reject(new Error("locked")), list: async () => Promise.reject(new Error("locked")) };
  expect(await modelKeys(vaultTokenSource(locked), {}).anthropic()).toBeNull();
  expect(await keyPlace(modelKeys(vaultTokenSource(locked), {}))).toBe("none");
});
