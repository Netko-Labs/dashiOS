import { expect, test } from "bun:test";
import { AnswerError, type PlanTool } from "../src/agents/ask/answerer.ts";
import { modelKeys } from "../src/agents/ask/keys.ts";
import { gptAnswerer, gptSchema, gptTool, readGptReply, withoutNulls } from "../src/agents/ask/lib/gpt.ts";
import { isChatModel, rankGptModels } from "../src/agents/ask/lib/gpt-models.ts";
import { planTools, stepsFrom } from "../src/agents/ask/plan.ts";
import { TOOL_ACTIONS } from "../src/agents/tools/index.ts";
import { gptModelWords, keyWords } from "../src/settings-app/panes/agents-answer.tsx";

const TOOLS = planTools(TOOL_ACTIONS);

test("the default model is the most capable chat model the key lists, never a guess", () => {
  const listed = [
    "whisper-1",
    "gpt-4o",
    "gpt-4o-mini",
    "o3",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5.1-2025-11-13",
    "gpt-5.1",
    "gpt-5-pro",
    "gpt-4o-realtime-preview",
    "text-embedding-3-large",
    "gpt-image-1",
    "gpt-5-codex",
    "dall-e-3",
  ];
  expect(rankGptModels(listed)).toEqual(["gpt-5.1", "gpt-5.1-2025-11-13", "gpt-5", "o3", "gpt-5-mini", "gpt-4o", "gpt-4o-mini"]);
  expect(rankGptModels(["gpt-4.1", "gpt-4.1-nano", "o4-mini"])).toEqual(["o4-mini", "gpt-4.1", "gpt-4.1-nano"]);
  expect(rankGptModels(["text-embedding-3-small"])).toEqual([]);
  expect(isChatModel("gpt-4o-audio-preview")).toBe(false);
  expect(isChatModel("chatgpt-4o-latest")).toBe(true);
});

test("strict function tools: every property required, the optional ones nullable, and nulls dropped again", () => {
  const schema = gptSchema({
    type: "object",
    properties: { target: { type: "string", enum: ["input", "output"] }, level: { type: "number", minimum: 0 }, muted: { type: "boolean" } },
    required: ["target"],
  });
  expect(schema).toEqual({
    type: "object",
    properties: { target: { type: "string", enum: ["input", "output"] }, level: { type: ["number", "null"] }, muted: { type: ["boolean", "null"] } },
    required: ["target", "level", "muted"],
    additionalProperties: false,
  });
  expect(withoutNulls({ target: "output", level: null, muted: true, deep: { a: null, b: 1 } })).toEqual({ target: "output", muted: true, deep: { b: 1 } });
  const setting = TOOLS.find((tool) => tool.name === "set_setting") as PlanTool;
  expect(gptTool(setting)).toMatchObject({ type: "function", function: { name: "set_setting", strict: true } });
});

test("a refusal, a filtered or a cut-off reply is never a plan; arguments that don't parse can't run", () => {
  const choice = (message: Record<string, unknown>, finish = "tool_calls") =>
    ({ choices: [{ index: 0, finish_reason: finish, logprobs: null, message: { role: "assistant", content: null, refusal: null, ...message } }] }) as never;
  expect(() => readGptReply(choice({ refusal: "No." }, "stop"))).toThrow("GPT declined this request.");
  expect(() => readGptReply(choice({}, "content_filter"))).toThrow("GPT declined");
  expect(() => readGptReply(choice({}, "length"))).toThrow("cut off");
  const reply = readGptReply(choice({ tool_calls: [{ id: "c1", type: "function", function: { name: "lock_screen", arguments: "{oops" } }] }));
  expect(reply.calls).toEqual([{ id: "c1", name: "lock_screen", input: null }]);
});

function fakeOpenAI(answers: { models?: string[]; completion?: unknown; status?: number; error?: unknown }) {
  const sent: Array<{ url: string; body: Record<string, unknown> | null; auth: string | null }> = [];
  const fetch = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    sent.push({ url, body: typeof init.body === "string" ? JSON.parse(init.body) : null, auth: headers.get("authorization") });
    if (answers.status) return Response.json(answers.error ?? { error: { message: "nope" } }, { status: answers.status });
    if (url.endsWith("/models"))
      return Response.json({ object: "list", data: (answers.models ?? []).map((id) => ({ id, object: "model", created: 0, owned_by: "openai" })) });
    return Response.json(answers.completion);
  };
  return { sent, fetch };
}

const completion = (calls: Array<[string, unknown]>, content: string | null = null) => ({
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 0,
  model: "gpt-5.1",
  choices: [
    {
      index: 0,
      finish_reason: calls.length > 0 ? "tool_calls" : "stop",
      logprobs: null,
      message: {
        role: "assistant",
        content,
        refusal: null,
        tool_calls: calls.map(([name, args], at) => ({ id: `call_${at}`, type: "function", function: { name, arguments: JSON.stringify(args) } })),
      },
    },
  ],
});

test("GPT plans through the SDK: the key's best model, strict tools, api.openai.com only, and a follow-up hears how it went", async () => {
  const openai = fakeOpenAI({
    models: ["gpt-4o", "gpt-5.1", "tts-1"],
    completion: completion([
      ["set_setting", { name: "dark_mode", value: true }],
      ["set_volume", { target: "output", level: null, muted: true }],
    ]),
  });
  const answer = gptAnswerer({ key: async () => "sk-test", model: () => null, fetch: openai.fetch, maxRetries: 0 });
  const first = await answer.turn([], { text: "dark mode and mute", results: [] }, TOOLS, new AbortController().signal);
  expect(openai.sent.map((each) => each.url)).toEqual(["https://api.openai.com/v1/models", "https://api.openai.com/v1/chat/completions"]);
  expect(openai.sent.every((each) => each.auth === "Bearer sk-test")).toBe(true);
  const body = openai.sent[1]?.body as { model: string; tools: Array<{ function: { strict: boolean } }>; messages: Array<{ role: string }>; store: boolean };
  expect(body.model).toBe("gpt-5.1");
  expect(body.tools.every((tool) => tool.function.strict)).toBe(true);
  expect(body.messages.map((message) => message.role)).toEqual(["developer", "user"]);
  expect(body.store).toBe(false);
  expect(stepsFrom(first.reply.calls, TOOL_ACTIONS).map((step) => [step.title, step.state.kind])).toEqual([
    ["Turn Dark Mode on", "ready"],
    ["Mute the sound", "ready"],
  ]);
  await answer.turn(first.history, { text: "and lock", results: [{ id: "call_0", text: "Done.", error: false }] }, TOOLS, new AbortController().signal);
  const follow = openai.sent.at(-1)?.body as { messages: Array<Record<string, unknown>> };
  expect(follow.messages.map((message) => message.role)).toEqual(["developer", "user", "assistant", "tool", "user"]);
  expect(follow.messages[3]).toMatchObject({ role: "tool", content: "Done." });
  expect(JSON.stringify(follow.messages[3])).toContain('"call_0"');
  // The model list is asked for once, not every turn.
  expect(openai.sent.filter((each) => each.url.endsWith("/models"))).toHaveLength(1);
});

test("the model the person picked is used as it is; the SDK's errors say what went wrong", async () => {
  const picked = fakeOpenAI({ completion: completion([], "I can't do that from here.") });
  const answer = gptAnswerer({ key: async () => "sk-test", model: () => "gpt-4o", fetch: picked.fetch, maxRetries: 0 });
  const reply = await answer.turn([], { text: "order a pizza", results: [] }, TOOLS, new AbortController().signal);
  expect(reply.reply).toEqual({ text: "I can't do that from here.", calls: [] });
  expect(picked.sent.map((each) => each.url)).toEqual(["https://api.openai.com/v1/chat/completions"]);

  const failure = async (answers: Parameters<typeof fakeOpenAI>[0], key: string | null = "sk-test") => {
    const openai = fakeOpenAI(answers);
    const failing = gptAnswerer({ key: async () => key, model: () => "gpt-5.1", fetch: openai.fetch, maxRetries: 0 });
    try {
      await failing.turn([], { text: "x", results: [] }, TOOLS, new AbortController().signal);
      return null;
    } catch (error) {
      return error instanceof AnswerError ? [error.failure, error.message] : String(error);
    }
  };
  expect(await failure({}, null)).toEqual(["no-key", "Add your OpenAI key in Settings › Agents."]);
  expect(await failure({ status: 401 })).toEqual(["no-key", "OpenAI didn't accept the key."]);
  expect(await failure({ status: 404 })).toEqual(["no-model", "The model “gpt-5.1” isn't available to your key."]);
  expect(await failure({ status: 429, error: { error: { message: "quota", code: "insufficient_quota", type: "insufficient_quota" } } })).toEqual([
    "failed",
    "Your OpenAI account has no credit left.",
  ]);
  expect(await failure({ status: 400, error: { error: { message: "Bad   tools\nhere" } } })).toEqual(["failed", "Bad tools here"]);
  // The key never shows up in what the person reads.
  expect(JSON.stringify(await failure({ status: 401 }))).not.toContain("sk-test");
});

test("GPT's key: the vault's openai item first, then OPENAI_API_KEY; Settings says where", async () => {
  const vault = {
    token: async (name: string, host: string) => (name === "openai" && host === "api.openai.com" ? "from-vault" : null),
    holds: async (name: string, host: string) => name === "openai" && host === "api.openai.com",
  };
  expect(await modelKeys(vault, { OPENAI_API_KEY: "from-env" }).openai()).toEqual({ key: "from-vault", place: "vault" });
  expect(await modelKeys(null, { OPENAI_API_KEY: " from-env " }).openai()).toEqual({ key: "from-env", place: "environment" });
  expect(await modelKeys(vault, {}).place("openai")).toBe("vault");
  expect(await modelKeys(vault, {}).place("anthropic")).toBe("none");
  expect(keyWords("vault", "openai")).toBe("In your vault. GPT never sees it.");
  expect(keyWords("none", "openai")).toContain("“openai” for api.openai.com");
  expect(gptModelWords(["gpt-5.1", "gpt-5"], undefined)).toBe("Answers with gpt-5.1, the most capable your key lists.");
  expect(gptModelWords(["gpt-5.1"], "gpt-5")).toBe("Answers with gpt-5.");
});
