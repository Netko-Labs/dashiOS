import { expect, test } from "bun:test";
import { AnswerError, type PlanTool } from "../src/agents/ask/answerer.ts";
import { ANTHROPIC_HOST, claudeAnswerer, type Fetch, readReply } from "../src/agents/ask/claude.ts";
import { ANTHROPIC_TOKEN, keyPlace, modelKeys, tokenSource } from "../src/agents/ask/keys.ts";
import { isModelName, LOCAL_URL, localAnswerer, localModels, readLocalReply } from "../src/agents/ask/local.ts";

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

test("Claude: one request to api.anthropic.com, the key in its header only, the words and the tools in the body", async () => {
  const send = recording({ content: [{ type: "tool_use", id: "c1", name: "lock_screen", input: {} }], stop_reason: "tool_use" });
  const claude = claudeAnswerer({ key: async () => KEY, fetch: send });
  const { reply, history } = await claude.turn([], { text: "lock up", results: [] }, TOOLS, signal());
  expect(reply.calls).toEqual([{ id: "c1", name: "lock_screen", input: {} }]);
  expect(send.calls).toHaveLength(1);
  const [{ url, init }] = send.calls as [{ url: string; init: RequestInit }];
  expect(new URL(url).host).toBe(ANTHROPIC_HOST);
  const headers = init.headers as Record<string, string>;
  expect(headers["x-api-key"]).toBe(KEY);
  const body = JSON.parse(String(init.body));
  expect(JSON.stringify(body)).not.toContain(KEY);
  expect(body.model).toBe("claude-opus-5-5");
  expect(body.tools).toEqual([{ name: "lock_screen", description: "Lock the screen", input_schema: TOOLS[0]?.schema }]);
  expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "lock up" }] }]);
  expect(body.temperature).toBeUndefined();
  // The assistant's content goes back as it came, for the next turn.
  expect(history.at(-1)).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "c1", name: "lock_screen", input: {} }] });
});

test("Claude: a follow-up reports how each call went first", async () => {
  const send = recording({ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" });
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

test("Claude: no key sends nothing; a refused key, a refusal and an outage say so without the key", async () => {
  const none = recording({});
  await expect(claudeAnswerer({ key: async () => null, fetch: none }).turn([], { text: "x", results: [] }, TOOLS, signal())).rejects.toMatchObject({
    failure: "no-key",
  });
  expect(none.calls).toEqual([]);
  for (const [status, failure] of [
    [401, "no-key"],
    [529, "no-answer"],
    [400, "failed"],
  ] as const) {
    const error = await claudeAnswerer({ key: async () => KEY, fetch: recording({ error: { message: "bad things" } }, status) })
      .turn([], { text: "x", results: [] }, TOOLS, signal())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnswerError);
    expect((error as AnswerError).failure).toBe(failure);
    expect((error as AnswerError).message).not.toContain(KEY);
  }
  expect(() => readReply({ content: [], stop_reason: "refusal" })).toThrow("Claude declined this request.");
  const offline: Fetch = async () => {
    throw new TypeError("network down");
  };
  await expect(claudeAnswerer({ key: async () => KEY, fetch: offline }).turn([], { text: "x", results: [] }, TOOLS, signal())).rejects.toMatchObject({
    failure: "no-answer",
  });
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

test("Claude's key: the vault's token for api.anthropic.com first, else ANTHROPIC_API_KEY, else none", async () => {
  const asked: Array<[string, string | undefined]> = [];
  const vault = {
    token: async (name: string, host?: string) => {
      asked.push([name, host]);
      return name === ANTHROPIC_TOKEN && host === ANTHROPIC_HOST ? "from-vault" : null;
    },
  };
  expect(await modelKeys(tokenSource(vault), { ANTHROPIC_API_KEY: "from-env" }).anthropic()).toEqual({ key: "from-vault", place: "vault" });
  expect(asked).toEqual([["anthropic", "api.anthropic.com"]]);
  // A vault without tokens (today's client), or one that has no such item: the session's key.
  expect(tokenSource({ cards: () => [] })).toBeNull();
  expect(await modelKeys(null, { ANTHROPIC_API_KEY: " from-env " }).anthropic()).toEqual({ key: "from-env", place: "environment" });
  const locked = { token: async () => Promise.reject(new Error("locked")) };
  expect(await keyPlace(modelKeys(tokenSource(locked), {}))).toBe("none");
});
