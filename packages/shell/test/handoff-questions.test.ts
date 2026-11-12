import { describe, expect, test } from "bun:test";
import { signInQuestion } from "../src/agents/handoff/questions.ts";
import { ask, setUp, who } from "./support/handoff-questions.ts";
import { settle as tick } from "./support/time.ts";

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
