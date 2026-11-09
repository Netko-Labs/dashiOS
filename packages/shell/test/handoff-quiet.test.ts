/**
 * A run that prints nothing (agents/handoff/quiet.ts): OpenCode with no
 * account waits on its free model's limit, printing no event and never
 * exiting. After a while its card says so plainly, with Sign In…, Keep
 * Waiting and Stop; errors it wrote say why; a known error reads plainly.
 */

import { expect, test } from "bun:test";
import type { Files } from "../src/agents/ask/harness/index.ts";
import { GrantsMemory, NO_CONTEXT } from "../src/agents/handoff/grants.ts";
import { plainFailure, quietQuestion, quietReason } from "../src/agents/handoff/quiet.ts";
import type { TaskRunner } from "../src/agents/handoff/runner.ts";
import { startHandoff, usesWords } from "../src/agents/handoff/service.ts";
import { statusWords } from "../src/agents/handoff/store.ts";

test("silence reads as signed out unless it is signed in; its errors say better", () => {
  expect(quietReason("", null)).toBe("signed-out");
  expect(quietReason("", false)).toBe("signed-out");
  expect(quietReason("", true)).toBe("quiet");
  expect(quietReason("Error: Rate limit exceeded for the free model", true)).toBe("limit");
  expect(quietReason("ProviderAuthError: No API key found for provider", true)).toBe("signed-out");
});

test("the question names the harness, says what to type, and offers Stop", () => {
  const signedOut = quietQuestion("OpenCode", "signed-out", "opencode auth login", 30);
  expect(signedOut.title).toBe("OpenCode isn't signed in");
  expect(signedOut.detail).toBe("It hasn't answered in 30 seconds. Sign in to a provider in Terminal (opencode auth login), then ask again.");
  expect(signedOut.choices.map((choice) => choice.label)).toEqual(["Sign In…", "Keep Waiting"]);
  expect(signedOut.needs).toBe("isn't signed in");
  expect(quietQuestion("OpenCode", "quiet", "opencode auth login").choices.map((choice) => choice.id)).toEqual(["wait"]);
  expect(quietQuestion("Codex", "limit", null).choices.map((choice) => choice.id)).toEqual(["wait"]);
  expect(usesWords("codex")).toBe("your ChatGPT plan");
  expect(usesWords("opencode")).toBe("OpenCode's configured provider");
  expect(plainFailure("OpenCode", "AI_APICallError: 429 Too Many Requests")).toBe("OpenCode's model is at its limit. Try again later.");
  expect(plainFailure("OpenCode", "401 Unauthorized")).toBe("OpenCode isn't signed in.");
  expect(plainFailure("OpenCode", "The page didn't load.")).toBe("The page didn't load.");
});

const files: Files = {
  isExecutable: (path) => path === "/home/alex/.local/bin/opencode",
  real: (path) => path,
  exists: () => false,
  head: () => null,
};

function quietService(errors = "") {
  const stopped: string[] = [];
  const watchers = new Map<string, { line: (line: string) => void; exit: (code: number | null) => void }>();
  const runner: TaskRunner = {
    start: async () => null,
    stop: (run, turn) => void stopped.push(`${run}:${turn}`),
    watch(run, turn, line, exit) {
      watchers.set(`${run}:${turn}`, { line, exit });
      return () => watchers.delete(`${run}:${turn}`);
    },
    forget: () => {},
    save: () => {},
    readTurn: () => null,
    readErrors: () => errors,
    found: () => ({ runs: [], running: new Map() }),
  };
  const signedIn: string[] = [];
  const handoff = startHandoff({
    settings: { getSnapshot: () => ({ data: { agents: {} } }), subscribe: () => () => {} },
    // No auth.json under this data folder: OpenCode isn't signed in.
    env: { HOME: "/home/alex", XDG_RUNTIME_DIR: "/run/user/1000", PATH: "/usr/bin", XDG_DATA_HOME: "/nonexistent-dashi-test" },
    runner,
    files,
    shell: { bun: "/usr/bin/bun", bridge: "/dashi/bin/dashi-mcp.ts", dashiAgent: "/dashi/bin/dashi-agent.ts", task: "/dashi/bin/dashi-task.ts" },
    memory: new GrantsMemory(null),
    newId: () => "run1",
    quietMs: 20,
    signIn: (harness) => void signedIn.push(harness),
  });
  return { handoff, stopped, watchers, signedIn };
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a fake OpenCode that prints nothing: its card asks, and Sign In… opens Terminal and stops it", async () => {
  const { handoff, stopped, signedIn } = quietService();
  await handoff.start({ harness: "opencode", request: "Book a class", context: NO_CONTEXT });
  expect(handoff.runs.get("run1")?.question).toBeNull();
  await settle(60);
  const run = handoff.runs.get("run1");
  expect(run?.question?.title).toBe("OpenCode isn't signed in");
  expect(run && statusWords(run)).toBe("isn't signed in");
  handoff.runs.answer("run1", run?.question?.id ?? "", "sign-in");
  await settle(5);
  expect(signedIn).toEqual(["opencode"]);
  expect(stopped).toEqual(["run1:1"]);
  handoff.close();
});

test("Keep Waiting asks again later; the card's Stop stops it", async () => {
  const { handoff, stopped } = quietService("Error: rate limit reached");
  await handoff.start({ harness: "opencode", request: "Book a class", context: NO_CONTEXT });
  await settle(60);
  const first = handoff.runs.get("run1")?.question;
  expect(first?.title).toBe("OpenCode is at its limit");
  handoff.runs.answer("run1", first?.id ?? "", "wait");
  await settle(5);
  expect(handoff.runs.get("run1")?.question).toBeNull();
  await settle(60);
  const again = handoff.runs.get("run1")?.question;
  expect(again?.title).toBe("OpenCode is at its limit");
  handoff.stop("run1");
  expect(stopped).toEqual(["run1:1"]);
  // Stopped, nothing waits on the person.
  expect(handoff.runs.get("run1")?.question).toBeNull();
  handoff.close();
});

test("a run that speaks in time is never asked, and one that ends with a known error says it plainly", async () => {
  const { handoff, watchers } = quietService("Error: 401 Unauthorized");
  await handoff.start({ harness: "opencode", request: "Book a class", context: NO_CONTEXT });
  watchers.get("run1:1")?.line(JSON.stringify({ type: "step_start", sessionID: "ses_1" }));
  await settle(60);
  expect(handoff.runs.get("run1")?.question).toBeNull();
  watchers.get("run1:1")?.exit(1);
  expect(handoff.runs.get("run1")?.phase).toBe("failed");
  expect(handoff.runs.get("run1")?.error).toBe("OpenCode isn't signed in.");
  handoff.close();
});
