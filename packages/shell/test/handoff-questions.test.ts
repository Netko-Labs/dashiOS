import { describe, expect, test } from "bun:test";
import { routedUi, signInQuestion } from "../src/agents/handoff/questions.ts";
import { QuestionRoute } from "../src/agents/handoff/route.ts";
import { AgentRuns } from "../src/agents/handoff/store.ts";
import type { AgentUi, Allow, Answer, SignInAsk, SignInChoice } from "../src/agents/presence.ts";
import { type PlanProfile, parsePlanProfile, sandboxArgs } from "../src/agents/sandbox.ts";
import { DENY } from "../src/agents/sheet-queue.ts";

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

/** The sheets, as a stand-in: each records it went up and came down, and answers when the test says. */
function sheets() {
  const up: string[] = [];
  const down: string[] = [];
  const answers = new Map<string, (value: unknown) => void>();
  /** A sheet of `kind`: up until answered, or taken down (then a no, as the queue answers). */
  const sheet =
    <T>(kind: string, no: T) =>
    (_ask: unknown, signal?: AbortSignal): Promise<T> => {
      up.push(kind);
      return new Promise<T>((resolve) => {
        answers.set(kind, resolve as (value: unknown) => void);
        signal?.addEventListener("abort", () => {
          down.push(kind);
          resolve(no);
        });
      });
    };
  const ui = {
    signIn: sheet<SignInChoice>("sign-in", { allow: "deny", login: null }),
    allowSite: sheet<Allow>("site", "deny"),
    ask: sheet<Answer>("scopes", DENY),
    confirm: sheet<boolean>("confirm", false),
    turn: sheet<boolean>("turn", false),
  } as unknown as AgentUi;
  return {
    ui,
    up,
    down,
    answer: (kind: string, value: unknown) => answers.get(kind)?.(value),
    answerSignIn: (choice: SignInChoice) => answers.get("sign-in")?.(choice),
  };
}

function setUp(open: boolean) {
  const runs = new AgentRuns();
  runs.start({ id: "run1", request: "Book a class", harness: "claude-code", harnessName: "Claude Code" });
  const listeners = new Set<(open: boolean) => void>();
  const attention: string[] = [];
  const fake = sheets();
  let panel = open;
  const ui = routedUi(fake.ui, {
    taskOf: (agent) => (agent === 7 ? "run1" : null),
    runs,
    panelOpen: () => panel,
    onPanel(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    attention: (_run, question) => attention.push(question.title),
  });
  const setPanel = (now: boolean) => {
    panel = now;
    for (const listener of [...listeners]) listener(now);
  };
  /** The panel's answer to the question on the card now, as the shell gives it: recorded, then the panel closes. */
  const answerInPanel = (choice: string) => {
    const answered = runs.answer("run1", runs.get("run1")?.question?.id ?? "", choice);
    if (choice !== "other") setPanel(false);
    return answered;
  };
  return { runs, ui, fake, attention, closePanel: () => setPanel(false), openPanel: () => setPanel(true), answerInPanel, listeners };
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
    fake.answerSignIn({ allow: "once", login: "op:2" });
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

  test("a hand-over: Done in the panel ends it; no banner while the panel is open", async () => {
    const { runs, ui, fake } = setUp(true);
    const done = ui.turn({ agent: 7, who, reason: "Solve the CAPTCHA" }, undefined);
    expect(fake.up).toEqual([]);
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

describe("a question shows in one place at a time", () => {
  test("the route: the panel open, no sheet; closed, the sheet and one notification", () => {
    expect(new QuestionRoute().start(true)).toEqual({});
    const route = new QuestionRoute();
    expect(route.start(false)).toEqual({ sheet: "show", notify: true });
    expect(route.panelOpened()).toEqual({ sheet: "hide" });
    expect(route.panelOpened()).toEqual({});
    expect(route.panelClosed()).toEqual({ sheet: "show" });
    expect(route.panelClosed()).toEqual({});
    expect(route.sheetShown).toBe(true);
  });

  test("the route: the first answer counts and takes the other place down; nothing after it", () => {
    const route = new QuestionRoute();
    route.start(false);
    expect(route.settle("panel")).toEqual({ counts: true, step: { sheet: "hide" } });
    expect(route.settle("sheet")).toEqual({ counts: false, step: {} });
    expect(route.settledBy).toBe("panel");
    expect(route.panelClosed()).toEqual({});
    expect(route.panelOpened()).toEqual({});
    const bySheet = new QuestionRoute();
    bySheet.start(false);
    expect(bySheet.settle("sheet")).toEqual({ counts: true, step: {} });
    expect(bySheet.settle("panel").counts).toBe(false);
  });

  test("opening the panel over the login sheet takes the sheet down: the card is the one place", async () => {
    const { runs, ui, fake, attention, openPanel, answerInPanel } = setUp(false);
    const answer = ui.signIn(ask, undefined);
    expect(fake.up).toEqual(["sign-in"]);
    openPanel();
    expect(fake.down).toEqual(["sign-in"]);
    expect(runs.get("run1")?.question?.title).toBe("Use your bodytech.com.co login?");
    // The sheet's own "no" as it came down didn't answer anything.
    await tick();
    expect(runs.get("run1")?.question).not.toBeNull();
    answerInPanel("task");
    expect(await answer).toEqual({ allow: "task", login: "dashi:1" });
    // The panel closing with the answer puts no sheet up, and one notification was all.
    expect(fake.up).toEqual(["sign-in"]);
    expect(attention).toHaveLength(1);
  });

  test("the panel closed unanswered: the sheet goes back up, with no second notification", async () => {
    const { ui, fake, attention, openPanel, closePanel } = setUp(false);
    void ui.signIn(ask, undefined);
    openPanel();
    closePanel();
    expect(fake.up).toEqual(["sign-in", "sign-in"]);
    expect(attention).toHaveLength(1);
  });

  test("answered in the sheet: the card goes, and a press on it later counts for nothing", async () => {
    const { runs, ui, fake } = setUp(false);
    const answer = ui.signIn(ask, undefined);
    const question = runs.get("run1")?.question?.id ?? "";
    fake.answerSignIn({ allow: "once", login: "dashi:1" });
    expect(await answer).toEqual({ allow: "once", login: "dashi:1" });
    expect(runs.get("run1")?.question).toBeNull();
    expect(runs.answer("run1", question, "deny")).toBe(false);
  });

  test("answered in both at once: only the first counts", async () => {
    const { runs, ui, fake } = setUp(false);
    const answer = ui.allowSite({ agent: 7, who, site: "bodytech.com.co" }, undefined);
    runs.answer("run1", runs.get("run1")?.question?.id ?? "", "always");
    fake.answer("site", "deny");
    expect(await answer).toBe("always");
    expect(runs.get("run1")?.question).toBeNull();
  });

  const kinds: ReadonlyArray<{ kind: string; start: (ui: AgentUi) => Promise<unknown>; yes: string; value: unknown }> = [
    { kind: "site", start: (ui: AgentUi) => ui.allowSite({ agent: 7, who, site: "bodytech.com.co" }, undefined), yes: "once", value: "once" },
    { kind: "sign-in", start: (ui: AgentUi) => ui.signIn(ask, undefined), yes: "task", value: { allow: "task", login: "dashi:1" } },
    { kind: "turn", start: (ui: AgentUi) => ui.turn({ agent: 7, who, reason: "Solve the CAPTCHA" }, undefined), yes: "done", value: true },
    {
      kind: "confirm",
      start: (ui: AgentUi) => ui.confirm({ agent: 7, who, summary: "quit Notes", detail: "", action: "Quit" }, undefined),
      yes: "yes",
      value: true,
    },
    {
      kind: "scopes",
      start: (ui: AgentUi) =>
        ui.ask(
          { agent: 7, who, scopes: [{ id: "files", label: "See your files", detail: "", needed: true }] } as unknown as Parameters<AgentUi["ask"]>[0],
          undefined,
        ),
      yes: "once",
      value: { allow: "once", scopes: ["files"] },
    },
  ];

  for (const each of kinds) {
    test(`${each.kind}: the panel open, only the card; closed, the sheet; answered once`, async () => {
      const open = setUp(true);
      const fromPanel = each.start(open.ui);
      expect(open.fake.up).toEqual([]);
      expect(open.attention).toEqual([]);
      open.answerInPanel(each.yes);
      expect(await fromPanel).toEqual(each.value);
      expect(open.fake.up).toEqual([]);
      expect(open.runs.get("run1")?.question).toBeNull();
      expect(open.listeners.size).toBe(0);

      const closed = setUp(false);
      const fromSheet = each.start(closed.ui);
      expect(closed.fake.up).toEqual([each.kind]);
      expect(closed.attention).toHaveLength(1);
      closed.openPanel();
      expect(closed.fake.down).toEqual([each.kind]);
      closed.answerInPanel(each.yes);
      expect(await fromSheet).toEqual(each.value);
      expect(closed.fake.up).toEqual([each.kind]);
      expect(closed.runs.get("run1")?.question).toBeNull();
    });
  }

  test("the agent gave up with the sheet up: the sheet and the card both go", async () => {
    const { runs, ui, fake } = setUp(false);
    const controller = new AbortController();
    const answer = ui.allowSite({ agent: 7, who, site: "bodytech.com.co" }, controller.signal);
    controller.abort();
    expect(await answer).toBe("deny");
    expect(fake.down).toEqual(["site"]);
    expect(runs.get("run1")?.question).toBeNull();
  });

  test("the run ended: its question settles as a no and the sheet comes down", async () => {
    const { runs, ui, fake } = setUp(false);
    const answer = ui.signIn(ask, undefined);
    runs.exited("run1", 0);
    expect(await answer).toEqual({ allow: "deny", login: null });
    expect(fake.down).toEqual(["sign-in"]);
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
