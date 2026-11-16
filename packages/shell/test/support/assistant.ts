/**
 * Dashi's assistant with nothing real behind it (agents/assistant/): a
 * model that answers from a script on Ollama's address, and an agents'
 * server that carries a call out from a table and tells the assistant of
 * it as the real one does (its gate, `before`, `after`).
 */

import { startAssistant } from "../../src/agents/assistant/assistant.ts";
import type { Assistant, AssistantOptions } from "../../src/agents/assistant/types.ts";
import type { TaskPolicy } from "../../src/agents/lib/session/session-types.ts";
import { type Call, parseCall } from "../../src/agents/tools/index.ts";
import { handTimers } from "./voice.ts";

/** One reply of the scripted model: words, and the calls it wants. */
export interface Reply {
  say?: string;
  calls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
}

const TOOLS = ["open_url", "read_page", "fill_element", "press", "set_setting", "close_window", "list_windows", "ask_person"].map((name) => ({
  name,
  description: name,
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
}));

export interface FakeAssistant {
  assistant: Assistant;
  timers: ReturnType<typeof handTimers>;
  /** What the model was sent, a request each: its messages. */
  sent: Array<{ messages: Array<{ role: string; content: string }>; tools: string[] }>;
  /** The calls the server carried out, in order. */
  ran: string[];
  /** The model's replies still to give. */
  script: Reply[];
  state: { now: number; locked: boolean; answerer: string | undefined; askEveryStep: boolean; allow: "always" | "once" | "deny" | null };
  said: string[];
  steps: string[];
  log: string[];
  talkLog: Array<Record<string, unknown>>;
  history: Array<{ request: string; steps: Array<{ title: string }> }>;
  undone: string[];
  ask(words: string, signal?: AbortSignal): Promise<{ say: string; failed?: unknown }>;
  /** Called as each call is carried out: a test stops or waits here. */
  onCall: (name: string) => void | Promise<void>;
}

export function fakeAssistant(script: Reply[], over: Partial<AssistantOptions> = {}): FakeAssistant {
  const timers = handTimers();
  const fake: Omit<FakeAssistant, "assistant" | "ask"> = {
    timers,
    sent: [],
    ran: [],
    script,
    state: { now: 1_000_000, locked: false, answerer: "local", askEveryStep: false, allow: null },
    said: [],
    steps: [],
    log: [],
    talkLog: [],
    history: [],
    undone: [],
    onCall: () => {},
  };
  const fetching = async (url: string, init: RequestInit): Promise<Response> => {
    if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "stub:1" }] });
    const body = JSON.parse(String(init.body));
    fake.sent.push({ messages: body.messages, tools: body.tools.map((tool: { function: { name: string } }) => tool.function.name) });
    const reply = fake.script.shift() ?? { say: "Nothing more." };
    const lines = [
      ...(reply.say ? (reply.say.match(/\S+\s*/g)?.map((word) => ({ message: { role: "assistant", content: word }, done: false })) ?? []) : []),
      ...(reply.calls
        ? [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: reply.calls.map((call) => ({ function: { name: call.name, arguments: call.arguments ?? {} } })),
              },
              done: false,
            },
          ]
        : []),
      { message: { role: "assistant", content: "" }, done: true },
    ];
    return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  };
  const connect = (task: string, policy: TaskPolicy) => ({
    async request(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
      if (method === "initialize") return {};
      if (method === "tools/list") return { tools: TOOLS };
      const name = String(params.name);
      const refused = policy.assistant?.refuses(name) ?? null;
      if (refused !== null) return { content: [{ type: "text", text: refused }], isError: true };
      const call = parseCall(params);
      if ("unknown" in call || "arguments" in call) return { content: [{ type: "text", text: "bad call" }], isError: true };
      const undo = assistant.before(task, call as Call);
      await fake.onCall(name);
      if (signal?.aborted) throw new DOMException("Stopped.", "AbortError");
      fake.ran.push(name);
      assistant.after(task, undo, true);
      return { content: [{ type: "text", text: name === "read_page" ? "YouTube\n[1] Search (text field)" : "ok" }] };
    },
    close() {},
  });
  const assistant: Assistant = startAssistant({
    settings: () => ({ agents: { answerer: fake.state.answerer as never }, voice: { askEveryStep: fake.state.askEveryStep } }),
    agents: () => ({ connect, stopTask: () => {}, grants: { get: () => new Set(), set: () => {} } as never }),
    ui: () => (fake.state.allow === null ? null : { ask: async (ask) => ({ allow: fake.state.allow ?? "deny", scopes: ask.scopes.map((scope) => scope.id) }) }),
    planner: { ask: async (words) => ({ say: `planned: ${words}` }) },
    keys: { anthropic: async () => null, openai: async () => null, place: async () => "none" } as never,
    harness: { env: {}, shell: { bun: "bun", bridge: "bridge", dashiAgent: "agent" }, files: { exists: () => false } as never },
    moment: async () => ({
      window: { app: "Helium", title: "New Tab", url: null },
      selection: null,
      time: new Date(2026, 10, 15, 21, 49),
      language: "en_US",
      desktop: { index: 1, of: 2, windows: 3 },
      apps: ["Calendar", "Helium", "Notes"],
      names: ["YouTube"],
      talk: "Answer in one or two short plain sentences.",
      about: "",
    }),
    name: () => "Dashi",
    locked: () => fake.state.locked,
    settingNow: () => false,
    setSettingAddress: () => "dashi://settings/set",
    runUndo: async (undo) => {
      fake.undone.push(undo.title);
      return { ok: true, text: "ok" };
    },
    history: { add: (record) => fake.history.push(record), undone: () => {} },
    talkLog: { add: (line) => fake.talkLog.push(line) },
    fetch: fetching,
    timers,
    now: () => fake.state.now,
    newId: () => "talk000001",
    log: (line) => fake.log.push(line),
    ...over,
  });
  const ask = (words: string, signal: AbortSignal = new AbortController().signal) =>
    assistant.ask(words, signal, { say: (text) => fake.said.push(text), step: (title) => fake.steps.push(title) });
  return Object.assign(fake, { assistant, ask });
}
