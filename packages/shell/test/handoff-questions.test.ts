import { describe, expect, test } from "bun:test";
import { routedUi, signInQuestion } from "../src/agents/handoff/questions.ts";
import { AgentRuns } from "../src/agents/handoff/store.ts";
import type { AgentUi, SignInAsk, SignInChoice } from "../src/agents/presence.ts";
import { type PlanProfile, parsePlanProfile, sandboxArgs } from "../src/agents/sandbox.ts";

const who = { name: "claude", detail: "~/.local/bin/claude", claims: null, remote: false };
const ask: SignInAsk = {
  agent: 7,
  who,
  summary: "sign in to bodytech.com.co",
  logins: [
    { key: "dashi:1", account: "alexk", site: "bodytech.com.co", source: "Dashi" },
    { key: "op:2", account: "alex.kim", site: "bodytech.com.co", source: "1Password" },
  ],
};

/** The sheets, as a stand-in: each records it went up, and answers when the test says. */
function sheets() {
  const up: string[] = [];
  const down: string[] = [];
  let answerSignIn: (choice: SignInChoice) => void = () => {};
  const ui = {
    signIn(_ask: SignInAsk, signal?: AbortSignal) {
      up.push("sign-in");
      signal?.addEventListener("abort", () => down.push("sign-in"));
      return new Promise<SignInChoice>((resolve) => {
        answerSignIn = resolve;
      });
    },
    allowSite: async () => "deny" as const,
    turn(_turn: unknown, signal?: AbortSignal) {
      up.push("turn");
      return new Promise<boolean>((resolve) => signal?.addEventListener("abort", () => resolve(false)));
    },
  } as unknown as AgentUi;
  return { ui, up, down, answer: (choice: SignInChoice) => answerSignIn(choice) };
}

function setUp(open: boolean) {
  const runs = new AgentRuns();
  runs.start({ id: "run1", request: "Book a class", harness: "claude-code", harnessName: "Claude Code" });
  const closed = new Set<() => void>();
  const attention: string[] = [];
  const fake = sheets();
  let panel = open;
  const ui = routedUi(fake.ui, {
    taskOf: (agent) => (agent === 7 ? "run1" : null),
    runs,
    panelOpen: () => panel,
    onPanelClosed(listener) {
      closed.add(listener);
      return () => closed.delete(listener);
    },
    attention: (_run, question) => attention.push(question.title),
  });
  const closePanel = () => {
    panel = false;
    for (const listener of closed) listener();
  };
  return { runs, ui, fake, attention, closePanel };
}

const tick = () => Bun.sleep(0);

describe("a task's questions in the panel", () => {
  test("which login: the first, in the panel, with no sheet while the panel is open", async () => {
    const { runs, ui, fake } = setUp(true);
    const answer = ui.signIn(ask, undefined);
    const question = runs.get("run1")?.question;
    expect(question?.title).toBe("Use your bodytech.com.co login?");
    expect(question?.detail).toBe("Dashi · alexk");
    expect(question?.choices.map((choice) => choice.label)).toEqual(["Allow for this task", "Once", "Other login…", "Don't"]);
    expect(fake.up).toEqual([]);
    runs.answer("run1", question?.id ?? "", "task");
    expect(await answer).toEqual({ allow: "task", login: "dashi:1" });
    expect(runs.get("run1")?.question).toBeNull();
  });

  test("Other login… moves to the next one; Once uses it", async () => {
    const { runs, ui } = setUp(true);
    const answer = ui.signIn(ask, undefined);
    runs.answer("run1", runs.get("run1")?.question?.id ?? "", "other");
    await tick();
    expect(runs.get("run1")?.question?.detail).toBe("1Password · alex.kim");
    runs.answer("run1", runs.get("run1")?.question?.id ?? "", "once");
    expect(await answer).toEqual({ allow: "once", login: "op:2" });
  });

  test("Don't is a no", async () => {
    const { runs, ui } = setUp(true);
    const answer = ui.signIn(ask, undefined);
    runs.answer("run1", runs.get("run1")?.question?.id ?? "", "deny");
    expect(await answer).toEqual({ allow: "deny", login: null });
  });

  test("with the panel closed the sheet shows too, a notification says so, and the sheet's answer counts", async () => {
    const { runs, ui, fake, attention } = setUp(false);
    const answer = ui.signIn(ask, undefined);
    expect(fake.up).toEqual(["sign-in"]);
    expect(attention).toEqual(["Use your bodytech.com.co login?"]);
    expect(runs.get("run1")?.question).not.toBeNull();
    fake.answer({ allow: "once", login: "op:2" });
    expect(await answer).toEqual({ allow: "once", login: "op:2" });
    // The panel's question goes with it.
    expect(runs.get("run1")?.question).toBeNull();
  });

  test("answered in the panel first, the sheet comes down", async () => {
    const { runs, ui, fake } = setUp(false);
    const answer = ui.signIn(ask, undefined);
    runs.answer("run1", runs.get("run1")?.question?.id ?? "", "task");
    expect(await answer).toEqual({ allow: "task", login: "dashi:1" });
    expect(fake.down).toEqual(["sign-in"]);
  });

  test("the panel closed without an answer: the sheet goes up then", async () => {
    const { ui, fake, closePanel } = setUp(true);
    void ui.signIn(ask, undefined);
    expect(fake.up).toEqual([]);
    closePanel();
    expect(fake.up).toEqual(["sign-in"]);
  });

  test("the agent gave up on the call: the question is taken back", async () => {
    const { runs, ui } = setUp(true);
    const controller = new AbortController();
    const answer = ui.signIn(ask, controller.signal);
    controller.abort();
    runs.stopping("run1");
    expect(await answer).toEqual({ allow: "deny", login: null });
    expect(runs.get("run1")?.question).toBeNull();
  });

  test("a hand-over: the banner shows, and Done in the panel ends it", async () => {
    const { runs, ui, fake } = setUp(true);
    const done = ui.turn({ agent: 7, who, reason: "Solve the CAPTCHA" }, undefined);
    expect(fake.up).toEqual(["turn"]);
    const question = runs.get("run1")?.question;
    expect(question?.title).toBe("Your turn: Solve the CAPTCHA");
    runs.answer("run1", question?.id ?? "", "done");
    expect(await done).toBe(true);
  });

  test("another agent's questions go to the sheets as before", async () => {
    const { runs, ui, fake } = setUp(true);
    void ui.signIn({ ...ask, agent: 9 }, undefined);
    expect(fake.up).toEqual(["sign-in"]);
    expect(runs.get("run1")?.question).toBeNull();
  });

  test("one login: no Other login…", () => {
    expect(signInQuestion({ ...ask, logins: ask.logins.slice(0, 1) }, 0).choices.map((choice) => choice.id)).toEqual(["task", "once", "deny"]);
  });
});

describe("a task's sandbox", () => {
  const task: PlanProfile = {
    socket: "/run/user/1000/dashi-mcp.sock",
    readOnly: [],
    state: ["/home/alex/.claude"],
    cwd: "/run/user/1000/dashi-task",
    task: true,
  };
  const args = sandboxArgs(["/home/alex/.local/bin/claude", "-p"], {
    env: { home: "/home/alex", runtime: "/run/user/1000", state: "/home/alex/.local/state", config: "/home/alex/.config" },
    exists: (path) => (path === "/home/alex/.claude" ? "dir" : null),
    bwrap: "bwrap",
    unit: "dashi-agent-task-ab12cd34-9.scope",
    bus: null,
    plan: task,
  });

  test("an empty home folder with only its login; Dashi's MCP socket where the bridge looks", () => {
    expect(args).toContain("--tmpfs");
    expect(args[args.indexOf("/home/alex") - 1]).toBe("--tmpfs");
    const at = args.indexOf("/run/user/1000/dashi-mcp.sock");
    expect(args.slice(at - 1, at + 2)).toEqual(["--bind", "/run/user/1000/dashi-mcp.sock", "/run/user/1000/dashi-mcp.sock"]);
    expect(args).not.toContain("/run/user/1000/dashi-plan.sock");
  });

  test("the profile's task flag survives its JSON", () => {
    expect(parsePlanProfile(JSON.stringify(task))).toEqual(task);
    expect(parsePlanProfile(JSON.stringify({ ...task, task: "yes" }))).toBeNull();
  });
});
