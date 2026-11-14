/** The capsule's pure parts (src/capsule/lib): what shows, the words that fit, a card's limit, the colours, the spoken yes. */

import { expect, test } from "bun:test";
import { spokenLine } from "../src/capsule/lib/line.tsx";
import { contrastWithWhite, dashiColours, dashiFill, inkColours } from "../src/capsule/lib/measures.ts";
import { cardContent, head, shownOf, tail } from "../src/capsule/lib/model.ts";
import { dotHeights } from "../src/capsule/lib/parts.tsx";
import { doneLine, planSpoken, spokenYesNo } from "../src/capsule/lib/words.ts";
import type { OpenCard } from "../src/capsule/types.ts";
import type { PillAsk } from "../src/shared/pill/index.ts";

const permission = (steps: string[]): PillAsk => ({
  kind: "permission",
  id: "t1",
  task: "t1",
  request: "Turn on Dark Mode and open Notes",
  steps,
  spoken: true,
  since: 1,
});
const open = (ask: PillAsk): OpenCard => ({ what: { ask }, keyboard: false, armsAt: 0, hears: false });

test("one thing shows: an open card first, then dictation, then Dashi", () => {
  const listening = { phase: "listening", text: "hi", answering: true } as const;
  expect(shownOf({ phase: "idle" }, { phase: "idle" }, null)).toEqual({ kind: "none" });
  expect(shownOf({ phase: "key-down" }, listening, null).kind).toBe("dictation");
  expect(shownOf({ phase: "idle" }, listening, null).kind).toBe("voice");
  const card = open(permission(["Turn Dark Mode on"]));
  expect(shownOf({ phase: "key-down" }, listening, card)).toEqual({ kind: "card", card, listening });
  expect(shownOf({ phase: "idle" }, { phase: "idle" }, card)).toEqual({ kind: "card", card, listening: null });
});

test("the words that fit keep their end while listening and their start otherwise", () => {
  expect(tail("one two three", 40)).toBe("one two three");
  expect(tail("the release notes are almost done and Alex is checking", 24)).toBe("…and Alex is checking");
  expect(head("the release notes are almost done", 12)).toBe("the release…");
  expect(tail("  spaced\n out  ", 40)).toBe("spaced out");
});

test("a card shows every step of a plan that fits, and names the task it answers", () => {
  const content = cardContent({ ask: permission(["Turn Dark Mode on", "Open “Notes”"]) }, "Dashi");
  expect(content).toMatchObject({
    kind: "permission",
    who: "Dashi asks",
    about: "“Turn on Dark Mode and open Notes”",
    question: "Do these 2 things?",
    whole: true,
    more: "",
  });
  expect(content.lines).toEqual(["1. Turn Dark Mode on", "2. Open “Notes”"]);
  expect(cardContent({ ask: permission(["Lock the screen"]) }, "Miso")).toMatchObject({ who: "Miso asks", question: "Do this?", lines: ["Lock the screen"] });
});

test("past the limit nothing is cut silently: the start, how much more, and not whole", () => {
  const steps = Array.from({ length: 8 }, (_, index) => `Step number ${index + 1}`);
  const content = cardContent({ ask: permission(steps) }, "Dashi");
  expect(content.whole).toBe(false);
  expect(content.lines).toHaveLength(5);
  expect(content.more).toBe("and 3 more steps");
  const long = cardContent({ reading: { id: "r", request: "what is new", text: "word ".repeat(200) } }, "Dashi");
  expect(long.whole).toBe(false);
  expect(long.lines).toHaveLength(1);
  expect(long.more).toMatch(/^and \d+ more characters$/);
});

test("a question with more choices than the card holds shows none of them as buttons", () => {
  const question = (choices: string[]): PillAsk => ({ kind: "question", id: "q", text: "Which one?", choices, who: "Codex", about: "", since: 1 });
  expect(cardContent({ ask: question(["a", "b"]) }, "Dashi")).toMatchObject({
    kind: "question",
    who: "Codex asks",
    about: "",
    whole: true,
    choices: ["a", "b"],
  });
  expect(cardContent({ ask: question(["a", "b", "c", "d", "e"]) }, "Dashi")).toMatchObject({ whole: false, choices: [] });
});

test("Dashi's fill is the design's for the agents' purple, and dark enough for white words for any other", () => {
  expect(dashiFill("#6E56CF")).toBe("#4a33b0");
  for (const colour of ["#1f8a5b", "#ffd400", "#ff7ab8", "#ffffff", "#101010"]) expect(contrastWithWhite(dashiFill(colour))).toBeGreaterThanOrEqual(7);
  expect(dashiFill("#101010")).toBe("#101010");
  expect(dashiColours("#6e56cf").onPrimary).toBe("#2f2080");
  expect(inkColours(false).fill).toBe("#1d1d1f");
  expect(inkColours(true)).toMatchObject({ fill: "#f4f4f6", text: "#1d1d1f" });
});

test("the dots are dots at rest and bars with the voice, the middle one tallest", () => {
  expect(dotHeights(0)).toEqual([4, 4, 4, 4, 4]);
  const loud = dotHeights(1);
  expect(loud[2]).toBe(19);
  expect(Math.max(...loud)).toBe(loud[2] ?? 0);
  expect(dotHeights(7)).toEqual(loud);
});

test("yes and no count only as the whole of what was said", () => {
  expect(spokenYesNo("Yes.")).toBe(true);
  expect(spokenYesNo(" sí ")).toBe(true);
  expect(spokenYesNo("No!")).toBe(false);
  expect(spokenYesNo("yes but only the first one")).toBeNull();
  expect(spokenYesNo("")).toBeNull();
});

test("a plan is said with how to say yes, and a finished task says what it did", () => {
  expect(planSpoken("Sure", ["Turn Dark Mode on"])).toBe("Sure. I would turn Dark Mode on. Say yes, or press Yes.");
  expect(planSpoken("", ["A", "B"])).toBe("My plan has 2 steps: A; B. Say yes, or press Yes.");
  const done = { kind: "done" };
  expect(doneLine([{ title: "Turn Dark Mode on", state: done }])).toEqual({ line: "Done: Turn Dark Mode on", ok: true });
  expect(
    doneLine([
      { title: "A", state: done },
      { title: "B", state: { kind: "failed" } },
    ]),
  ).toEqual({ line: "1 of 2 steps didn't work.", ok: false });
});

test("the spoken line shows the line being said: said words, then the ones to come", () => {
  const words = "It is half past eleven on Friday night and the build is green".split(" ");
  expect(spokenLine(words, -1, 30)).toEqual({ said: "", coming: "It is half past eleven on" });
  expect(spokenLine(words, 2, 30)).toEqual({ said: "It is half", coming: "past eleven on" });
  expect(spokenLine(words, 8, 30)).toEqual({ said: "Friday night and", coming: "the build is" });
});
