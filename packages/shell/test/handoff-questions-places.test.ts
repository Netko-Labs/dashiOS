import { describe, expect, test } from "bun:test";
import { QuestionRoute } from "../src/agents/handoff/lib/route.ts";
import type { AgentUi } from "../src/agents/presence.ts";
import { ask, setUp, who } from "./support/handoff-questions.ts";
import { settle as tick } from "./support/time.ts";

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
