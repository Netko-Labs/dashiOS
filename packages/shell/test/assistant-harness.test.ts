/**
 * Way one (agents/assistant/lib/harness.ts; decisions.md D148): a harness
 * drives the full server for a spoken ask, in the sandbox as a launcher run
 * is, its stream read as it is printed so words are spoken as they come,
 * and every ask of a conversation after the first resumes its session.
 * Claude Code itself is not run here: the lines are ones it prints.
 */

import { expect, test } from "bun:test";
import { ClaudeStream } from "../src/agents/assistant/lib/claude-model.ts";
import { askHarness, claudeCommand, SaidOnce, type Spawner } from "../src/agents/assistant/lib/harness.ts";
import { ASSISTANT_PROMPT } from "../src/agents/assistant/prompt.ts";

const files = { isExecutable: (path: string) => path === "/home/alexk/.local/bin/claude", real: (path: string) => path, exists: () => true, head: () => null };
const host = (spawn: Spawner) => ({
  env: { HOME: "/home/alexk", XDG_RUNTIME_DIR: "/run/user/1000", PATH: "/usr/bin", ANTHROPIC_API_KEY: "never-passed" },
  shell: { bun: "/usr/libexec/dashi/bin/bun", bridge: "/usr/lib/dashi/bin/dashi-mcp.ts", dashiAgent: "/usr/lib/dashi/bin/dashi-agent.ts" },
  files,
  spawn,
});

const line = (value: unknown): string => JSON.stringify(value);
const delta = (text: string): string => line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
const STREAM = [
  line({ type: "system", subtype: "init", session_id: "s-1" }),
  delta("Opening YouTube "),
  delta("in Helium."),
  line({ type: "assistant", message: { content: [{ type: "text", text: "Opening YouTube in Helium." }] } }),
  line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__dashi__open_url", input: { url: "https://www.youtube.com" } }] } }),
  line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "Opened." }] } }),
  line({ type: "assistant", message: { content: [{ type: "text", text: "YouTube is open." }] } }),
  line({ type: "result", subtype: "success", session_id: "s-1", result: "YouTube is open." }),
];

function spawner(lines: string[], code = 0, errors = "") {
  const runs: Array<{ argv: readonly string[]; env: Record<string, string>; stdin: string; stopped: boolean }> = [];
  const spawn: Spawner = (argv, { env, stdin }) => {
    const run = { argv, env, stdin, stopped: false };
    runs.push(run);
    return {
      pid: 4242,
      lines: async (onLine) => {
        for (const each of lines) onLine(each);
      },
      exited: Promise.resolve({ code, errors }),
      stop: () => {
        run.stopped = true;
      },
    };
  };
  return { spawn, runs };
}

test("it runs in the sandbox as a task named for the conversation, on the full server, with the assistant's prompt and nothing of its own", async () => {
  const { spawn, runs } = spawner(STREAM);
  const said: string[] = [];
  const end = await askHarness(host(spawn), {
    harness: "claude-code",
    task: "talk000001",
    prompt: "open Helium and go to YouTube",
    system: ASSISTANT_PROMPT,
    session: null,
    signal: new AbortController().signal,
    say: (text) => said.push(text),
  });
  const [run] = runs;
  const argv = run?.argv ?? [];
  expect(argv.slice(0, 6)).toEqual([
    "/usr/libexec/dashi/bin/bun",
    "/usr/lib/dashi/bin/dashi-agent.ts",
    "--name",
    "task-talk000001",
    "--",
    "/home/alexk/.local/bin/claude",
  ]);
  expect(argv).toEqual(expect.arrayContaining(["-p", "stream-json", "--include-partial-messages", "--strict-mcp-config", "mcp__dashi", "dontAsk"]));
  expect(argv[argv.indexOf("--tools") + 1]).toBe("");
  expect(argv[argv.indexOf("--system-prompt") + 1]).toBe(ASSISTANT_PROMPT);
  expect(argv).not.toContain("--resume");
  expect(run?.stdin).toBe("open Helium and go to YouTube");
  const profile = JSON.parse(run?.env.DASHI_AGENT_PLAN ?? "{}");
  expect(profile).toMatchObject({ socket: "/run/user/1000/dashi-mcp.d/dashi-mcp.sock", task: true, cwd: "/run/user/1000/dashi-assistant" });
  // A key in the session never reaches it: it answers with the login the person set up.
  expect(run?.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(end).toEqual({ session: "s-1", said: "Opening YouTube in Helium.\n\nYouTube is open.", error: null, missing: false });
  // The first words were told as they were written, before the whole message came; nothing was said twice.
  expect(said.slice(0, 2)).toEqual(["Opening YouTube ", "in Helium."]);
  expect(said.join("").replace(/\s+/g, " ").trim()).toBe("Opening YouTube in Helium. YouTube is open.");
});

test("every ask after a conversation's first resumes its session", () => {
  const mcp = { command: "bun", args: ["dashi-mcp.ts"], env: {} };
  const args = claudeCommand({ prompt: "search for lo-fi", system: "s", session: "s-1", mcp }).args;
  expect(args.slice(-2)).toEqual(["--resume", "s-1"]);
});

test("a stop reaches the harness; one that is not installed, or that fails, is said so", async () => {
  const stopping = spawner(STREAM.slice(0, 2));
  const controller = new AbortController();
  controller.abort();
  await askHarness(host(stopping.spawn), {
    harness: "claude-code",
    task: "t1234",
    prompt: "x",
    system: "s",
    session: null,
    signal: controller.signal,
    say: () => {},
  });
  expect(stopping.runs[0]?.stopped).toBe(true);
  const missing = await askHarness(
    { ...host(stopping.spawn), files: { ...files, isExecutable: () => false } },
    { harness: "claude-code", task: "t1234", prompt: "x", system: "s", session: null, signal: new AbortController().signal, say: () => {} },
  );
  expect(missing.missing).toBe(true);
  const failing = spawner([], 1, "Invalid API key · Please run /login");
  const failed = await askHarness(host(failing.spawn), {
    harness: "claude-code",
    task: "t1234",
    prompt: "x",
    system: "s",
    session: null,
    signal: new AbortController().signal,
    say: () => {},
  });
  expect(failed).toMatchObject({ said: "", error: "Invalid API key · Please run /login" });
});

test("words printed in chunks and then whole are said once; a harness that prints no chunks is said whole", () => {
  const said: string[] = [];
  const once = new SaidOnce((text) => said.push(text));
  once.partial("Hello ");
  once.partial("there.");
  once.message("Hello there.");
  once.message("Done.");
  expect(said).toEqual(["Hello ", "there.", "\n\n", "Done.", "\n\n"]);
  expect(once.whole.trim()).toBe("Hello there.\n\nDone.");
});

test("Claude's stream with a key: the blocks are put back together, the words told as they come, a call's arguments read at its end", () => {
  const told: string[] = [];
  const stream = new ClaudeStream((text) => told.push(text));
  for (const event of [
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "The site." } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Opening " } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "YouTube." } },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t1", name: "open_url", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"url":"https://www.' } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: 'youtube.com"}' } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ])
    stream.event(event);
  expect(told).toEqual(["Opening ", "YouTube."]);
  expect(stream.stop).toBe("tool_use");
  expect(stream.content).toEqual([
    { type: "thinking", thinking: "The site.", signature: "sig" },
    { type: "text", text: "Opening YouTube." },
    { type: "tool_use", id: "t1", name: "open_url", input: { url: "https://www.youtube.com" } },
  ]);
});
