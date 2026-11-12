import { expect, test } from "bun:test";
import type { PlanTool } from "../src/agents/ask/answerer.ts";
import type { Fetch } from "../src/agents/ask/lib/http.ts";
import { isModelName, LOCAL_TOOLS, LOCAL_URL, localAnswerer, localModels, readLocalReply, toolsForRequest } from "../src/agents/ask/local.ts";
import { signal, TOOLS } from "./support/agents-ask-models.ts";

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

test("local: only the tools the request names reach a small model, best first, and it isn't asked to think aloud", async () => {
  const tool = (name: string, description: string): PlanTool => ({
    name,
    description,
    schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  });
  const tools = [
    tool("list_windows", "The open windows."),
    tool("lock_screen", "Lock the screen, as the person would."),
    tool("set_setting", "Turn dark_mode or night_shift on or off."),
    ...Array.from({ length: 40 }, (_, index) => tool(`other_${index}`, "Something else entirely.")),
  ];
  const picked = toolsForRequest("turn on dark mode and lock the screen", tools).map((each) => each.name);
  expect(picked).toEqual(["lock_screen", "set_setting"]);
  // Nothing matches: the first few, so the model can still say it can't.
  expect(toolsForRequest("xyzzy", tools)).toHaveLength(LOCAL_TOOLS);

  let body: Record<string, unknown> = {};
  const send: Fetch = async (url, init) => {
    if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen3:1.7b" }] });
    body = JSON.parse(String(init?.body));
    return Response.json({ message: { role: "assistant", content: "ok" } });
  };
  await localAnswerer({ model: () => null, fetch: send }).turn([], { text: "lock the screen", results: [] }, tools, new AbortController().signal);
  expect(body.think).toBe(false);
  expect((body.tools as unknown[]).length).toBeLessThanOrEqual(LOCAL_TOOLS);
});
