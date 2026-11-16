import { expect, test } from "bun:test";
import { tidy } from "../src/dictation/lib/tidy.ts";
import { breakdown, judge, loadPairs, type Pair } from "./support/rewrite-eval/score.ts";

const pairs = loadPairs();
const pair = (heard: string, want: string, also: string[] = []): Pair => ({ id: "x", lang: "en", tags: [], heard, want, also });

test("the set is large enough, a third of it Spanish or mixed, and every id is its own", () => {
  expect(pairs.length).toBeGreaterThanOrEqual(300);
  const spanish = pairs.filter((row) => row.lang !== "en").length;
  expect(spanish / pairs.length).toBeGreaterThanOrEqual(1 / 3);
  expect(new Set(pairs.map((row) => row.id)).size).toBe(pairs.length);
  for (const lang of ["en", "es", "mix"]) {
    expect(pairs.filter((row) => row.lang === lang && row.tags.includes("self-correction")).length).toBeGreaterThanOrEqual(30);
  }
  // Every row of the owner's corpus is there.
  expect(new Set(pairs.flatMap((row) => (row.corpus === undefined ? [] : [row.corpus]))).size).toBe(33);
});

test("a pair tagged restraint wants what was heard, and no other pair does", () => {
  for (const row of pairs) {
    if (row.tags.includes("restraint")) expect([row.id, row.want]).toEqual([row.id, row.heard]);
  }
});

test("judging: exact, close, and a word lost", () => {
  expect(judge(pair("at five, no, six", "At six."), "At six.")).toEqual({ noop: false, exact: true, close: true, damaged: false });
  expect(judge(pair("at five, no, six", "At six."), "at six")).toEqual({ noop: false, exact: false, close: true, damaged: false });
  expect(judge(pair("send it to Ana at five, no, six", "Send it to Ana at six."), "Send it at six.").damaged).toBe(true);
  expect(judge(pair("It works.", "It works."), "It works.")).toEqual({ noop: true, exact: true, close: true, damaged: false });
  expect(judge(pair("It works.", "It works."), "It runs.")).toEqual({ noop: true, exact: false, close: false, damaged: true });
  expect(judge(pair("It just start.", "It just start.", ["It just starts."]), "It just starts.").exact).toBe(true);
});

test("doing nothing keeps every sentence that was right, mends none, and loses no word", () => {
  const all = breakdown(pairs, new Map()).get("all");
  expect(all?.restraint).toBe(1);
  expect(all?.damage).toBe(0);
  expect(all?.edit).toBeLessThan(0.02);
});

test("the rules alone: nearly every right sentence kept, few mended (the baseline a model must beat)", () => {
  const answers = new Map(pairs.map((row) => [row.id, tidy(row.heard).typed]));
  const all = breakdown(pairs, answers).get("all");
  expect(all?.restraint).toBeGreaterThan(0.95);
  expect(all?.edit).toBeLessThan(0.15);
  expect(all?.damage).toBeLessThan(0.02);
});
