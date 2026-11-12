/**
 * ask_person (docs/actions.md, "Asking the person"): the tool and its own
 * consent kind; the person's words by voice or typing, or plainly none,
 * never an answer made up; the sheet that waits as long as the agent said;
 * and what it is never a way round.
 */

import { expect, test } from "bun:test";
import { ASKS_EVERY_TIME } from "../src/actions/tools.ts";
import { type QuestionVoice, questionSheet } from "../src/agent-sheets/lib/agent-sheet-views.tsx";
import { spokenQuestion } from "../src/agent-sheets/lib/question-sheet.tsx";
import { ALONE_SCOPES, coversTool, NEVER_ALONE_TOOLS } from "../src/agents/alone/rules.ts";
import { kept, SCOPES } from "../src/agents/consent.ts";
import type { RunContext } from "../src/agents/context.ts";
import { askPerson } from "../src/agents/desktop/ask-person.ts";
import { TOOL_ACTIONS } from "../src/agents/index.ts";
import { Scopes } from "../src/agents/lib/session/session-scopes.ts";
import type { SessionContext } from "../src/agents/lib/session/session-types.ts";
import type { Answer, PersonAnswer, PersonAsk } from "../src/agents/presence.ts";
import { DENY, SheetQueue } from "../src/agents/sheet-queue.ts";
import { INSTRUCTIONS, parseCall, scopeOf } from "../src/agents/tools/registry.ts";

const WHO = { name: "claude", detail: "/usr/bin/claude", claims: null, remote: false };
const ASK: PersonAsk = { agent: 1, who: WHO, question: "Which calendar should the event go in?", seconds: 60 };

test("ask_person takes one short question and how long to wait, and needs its own permission", () => {
  expect(parseCall({ name: "ask_person", arguments: { question: "  Which\ncalendar? " } })).toEqual({
    name: "ask_person",
    question: "Which calendar?",
    seconds: 60,
  });
  expect(parseCall({ name: "ask_person", arguments: { question: "Which?", seconds: 300 } })).toMatchObject({ seconds: 300 });
  for (const bad of [{}, { question: "" }, { question: "x".repeat(301) }, { question: "Which?", seconds: 5 }, { question: "Which?", answer: "Work" }]) {
    expect(parseCall({ name: "ask_person", arguments: bad })).toHaveProperty("arguments");
  }
  expect(scopeOf({ name: "ask_person", question: "Which?", seconds: 60 })).toBe("ask");
  expect(SCOPES.find((scope) => scope.id === "ask")?.label).toBe("Ask you questions");
  // Only agents ask: it is no command of the person's, and no plan step.
  const action = TOOL_ACTIONS.find((each) => each.tool === "ask_person");
  expect(action?.who).toBe("agents");
  expect(action?.readOnly).toBe(true);
  expect(INSTRUCTIONS).toContain("never guess one");
});

test("it is a permission like the others: kept by Always Allow, and Work alone may cover it, but never what asks every time", () => {
  expect([...kept(new Set(), ["ask"], new Set())]).toEqual(["ask"]);
  expect(ALONE_SCOPES).toContain("ask");
  const alone = { on: true as const, ends: 10_000, scopes: ["ask" as const], sites: [], throughLock: false, started: 0, minutes: 1 };
  expect(coversTool(alone, "ask_person", "ask", 5_000)).toBe(true);
  // A question's answer is words, never a permission: what always asks still does, alone or not.
  expect(NEVER_ALONE_TOOLS.has("ask_person")).toBe(false);
  expect(ASKS_EVERY_TIME.has("ask_person")).toBe(false);
  for (const tool of ["pay", "sign_in", "fill_code", "force_quit_app", "trash_file"]) expect(coversTool(alone, tool, "ask", 5_000)).toBe(false);
});

const context = (answer: PersonAnswer, asked: Array<[string, number]> = []): RunContext =>
  ({
    status: () => {},
    question: async (question: string, seconds: number) => {
      asked.push([question, seconds]);
      return answer;
    },
  }) as unknown as RunContext;

test("the agent gets the person's own words and how they gave them", async () => {
  const asked: Array<[string, number]> = [];
  const voice = await askPerson({ question: "Which calendar?", seconds: 45 }, context({ text: "The work one.", by: "voice" }, asked));
  expect(asked).toEqual([["Which calendar?", 45]]);
  expect(voice.isError).toBeUndefined();
  expect(voice.structuredContent).toEqual({ answered: true, answer: "The work one.", by: "voice" });
  const typed = await askPerson({ question: "Which calendar?", seconds: 45 }, context({ text: "Work", by: "typing" }));
  expect(typed.structuredContent).toEqual({ answered: true, answer: "Work", by: "typing" });
});

test("no answer is said plainly, and never invented", async () => {
  const late = await askPerson({ question: "Which calendar?", seconds: 45 }, context({ none: "no-answer" }));
  expect(late.structuredContent).toEqual({
    answered: false,
    reason: "The person did not answer within 45 seconds. There is no answer: don't guess one, and don't ask the same thing again unless the person agrees.",
  });
  const no = await askPerson({ question: "Which calendar?", seconds: 45 }, context({ none: "declined" }));
  expect(no.structuredContent?.answered).toBe(false);
  expect(String(no.structuredContent?.reason)).toStartWith("The person chose not to answer.");
  expect(no.structuredContent).not.toHaveProperty("answer");
});

/** A question sheet as the queue holds it: its answers by the sheet (`typed`) and from outside it (`spoken`). */
function sheet(voice: QuestionVoice | null) {
  const answers: PersonAnswer[] = [];
  const entry = questionSheet(ASK, voice, (answer) => answers.push(answer));
  return { entry, answers };
}

test("typed, spoken, declined, and left unanswered each come back as what they are", () => {
  const typed = sheet(null);
  typed.entry.resolve({ allow: "once", scopes: ["  Work "] });
  expect(typed.answers).toEqual([{ text: "Work", by: "typing" }]);

  const said: string[] = [];
  let ended = 0;
  const voice: QuestionVoice = {
    ask(words, heard) {
      said.push(words);
      heard("The work one.");
      return () => ended++;
    },
    talkKey: () => "the right ❖ key",
  };
  const spoken = sheet(voice);
  const given: Answer[] = [];
  const hidden = spoken.entry.shown?.((answer) => given.push(answer));
  expect(said).toEqual([spokenQuestion(ASK)]);
  expect(said[0]).toBe("claude asks: Which calendar should the event go in?");
  expect(given).toEqual([{ allow: "once", scopes: ["The work one."] }]);
  spoken.entry.resolve(given[0] ?? DENY);
  expect(spoken.answers).toEqual([{ text: "The work one.", by: "voice" }]);
  hidden?.();
  expect(ended).toBe(1);

  // The time ran out (the queue's DENY), and an empty answer is no answer.
  const silent = sheet(null);
  silent.entry.resolve(DENY);
  silent.entry.resolve({ allow: "once", scopes: ["   "] });
  expect(silent.answers).toEqual([{ none: "no-answer" }, { none: "no-answer" }]);
  expect(spokenQuestion({ who: { ...WHO, remote: true }, question: "Ready?" })).toBe("An agent on another machine asks: Ready?");
});

test("a question waits as long as the agent said once it shows, not the queue's two minutes", () => {
  const due: Array<{ ms: number; run: () => void }> = [];
  const answers: PersonAnswer[] = [];
  const queue = new SheetQueue<ReturnType<typeof questionSheet>>({
    open: () => ({ close() {} }),
    later: (run, ms) => {
      due.push({ ms, run });
      return () => {};
    },
  });
  queue.enqueue(questionSheet({ ...ASK, seconds: 45 }, null, (answer) => answers.push(answer)));
  expect(due.map((each) => each.ms)).toEqual([45_000]);
  due[0]?.run();
  expect(answers).toEqual([{ none: "no-answer" }]);
});

function scopes(options: { locked?: boolean; closed?: boolean; answer?: PersonAnswer }) {
  const asked: PersonAsk[] = [];
  const statuses: string[] = [];
  const ctx = {
    lock: { isLocked: options.locked ?? false },
    ui: {
      question: async (ask: PersonAsk) => {
        asked.push(ask);
        return options.answer ?? { text: "Work", by: "typing" as const };
      },
    },
  } as unknown as SessionContext;
  const host = {
    id: 4,
    who: () => WHO,
    grantKey: () => "claude",
    closed: () => options.closed ?? false,
    setStatus: (text: string) => statuses.push(text),
    resetStatus: () => {},
    run: () => {},
    reply: () => {},
  };
  return { scopes: new Scopes(new Set(["ask"]), ctx, host, null), asked, statuses };
}

test("the question names who asks, the agent waits on the person meanwhile, and a locked screen or a gone agent gets no answer", async () => {
  const open = scopes({});
  const signal = new AbortController().signal;
  expect(await open.scopes.asks(signal).question("Which calendar?", 30)).toEqual({ text: "Work", by: "typing" });
  expect(open.asked).toEqual([{ agent: 4, who: WHO, question: "Which calendar?", seconds: 30 }]);
  expect(open.statuses).toEqual(["Waiting for you", "Connected"]);

  const locked = scopes({ locked: true });
  expect(await locked.scopes.question("Which calendar?", 30, signal)).toEqual({ none: "no-answer" });
  expect(locked.asked).toEqual([]);
  const gone = scopes({ closed: true });
  expect(await gone.scopes.question("Which calendar?", 30, signal)).toEqual({ none: "no-answer" });
  const given = new AbortController();
  given.abort();
  expect(await scopes({}).scopes.question("Which calendar?", 30, given.signal)).toEqual({ none: "no-answer" });
});
