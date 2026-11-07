import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, hasOperation, repeatOf, tokenize } from "../apps/calculator/expression.ts";
import { fromField } from "../apps/calculator/field.ts";
import { keyForChar } from "../apps/calculator/keys.ts";
import { fieldWidth, keySide, MIN_SIZE, openingSize, sizeWithTape, TAPE_WIDTH } from "../apps/calculator/layout.ts";
import { EMPTY_LINE, equals, type Line, liveResult, negate, recall, tidy, typeChar } from "../apps/calculator/line.ts";
import { EN_US, numberLocale } from "../apps/calculator/locale.ts";
import { calculatorMenus } from "../apps/calculator/menus.ts";
import { type CalcAction, type CalcState, calculate, initialState } from "../apps/calculator/state.ts";
import { parseRemembered, readRemembered, TAPE_LIMIT, withEntry, writeRemembered } from "../apps/calculator/store.ts";
import { resultWords } from "../apps/calculator/words.ts";

const DE = numberLocale("de-DE");
const work = (text: string, locale = EN_US) => evaluate(tokenize(text, locale));
const value = (text: string, locale = EN_US): number | null => {
  const outcome = work(text, locale);
  return outcome.kind === "value" ? outcome.value : null;
};
const typed = (text: string, from: Line = EMPTY_LINE, locale = EN_US): Line => [...text].reduce((line, char) => typeChar(line, char, locale), from);
/** Runs actions from a fresh state. */
const run = (actions: CalcAction[], from: CalcState = initialState()): CalcState => actions.reduce(calculate, from);
/** Typing `text` into an empty field: the field's text after each key. */
const keys = (text: string): CalcAction[] => [...text].map((_, at) => ({ type: "field", text: text.slice(0, at + 1), locale: EN_US }) as const);

describe("working out", () => {
  test("× and ÷ before + and −, brackets first", () => {
    expect(value("2 + 3 × 4")).toBe(14);
    expect(value("(2 + 3) × 4")).toBe(20);
    expect(value("2(3 + 4)")).toBe(14);
    expect(value("10 − 4 − 3")).toBe(3);
    expect(value("−5 × −2")).toBe(10);
    expect(value("1 ÷ 3 × 3")).toBe(1);
  });

  test("% is a share of what it is added to, else a hundredth", () => {
    expect(value("200 + 10%")).toBe(220);
    expect(value("200 − 10%")).toBe(180);
    expect(value("50 × 10%")).toBe(5);
    expect(value("10%")).toBe(0.1);
  });

  test("what is still being typed is set aside: a trailing operator, an open bracket", () => {
    expect(value("12 +")).toBe(12);
    expect(value("(2 + 3")).toBe(5);
    expect(work("")).toEqual({ kind: "none" });
  });

  test("errors say what happened", () => {
    expect(work("1 ÷ 0")).toEqual({ kind: "error", reason: "divide-by-zero" });
    expect(work("1e300 × 1e300")).toEqual({ kind: "error", reason: "too-large" });
    expect(work("2 + )")).toEqual({ kind: "error", reason: "malformed" });
  });

  test("a double's noise is not shown", () => {
    expect(value("0.1 + 0.2")).toBe(0.3);
  });

  test("a lone number asks for no working out; = again repeats the last step", () => {
    expect(hasOperation(tokenize("−5", EN_US))).toBe(false);
    expect(hasOperation(tokenize("5%", EN_US))).toBe(true);
    expect(repeatOf(tokenize("2 + 3 × 4", EN_US))).toEqual([
      { kind: "op", op: "×" },
      { kind: "number", whole: "4", fraction: null, exponent: "" },
    ]);
    expect(repeatOf(tokenize("(2 + 3)", EN_US))).toBeNull();
  });
});

describe("the line", () => {
  test("keeps itself tidy as it is typed", () => {
    expect(typed("1250*12+340").text).toBe("1,250 × 12 + 340");
    expect(typed("3x-2").text).toBe("3 × −2");
    expect(typed("12/4").text).toBe("12 ÷ 4");
    expect(typed("1250*12+340", EMPTY_LINE, DE).text).toBe("1.250 × 12 + 340");
  });

  test("letters type nothing; two operators in a row keep the second", () => {
    expect(typed("1c2").text).toBe("12");
    expect(typed("3+×4").text).toBe("3 × 4");
    expect(typed("×5").text).toBe("5");
  });

  test("the caret stays after the same digit as the grouping moves", () => {
    expect(tidy("1234", 4, EN_US)).toEqual({ text: "1,234", caret: 5 });
    expect(tidy("12+3", 3, EN_US)).toEqual({ text: "12 + 3", caret: 4 });
    expect(tidy("1,2345", 2, EN_US)).toEqual({ text: "12,345", caret: 1 });
  });

  test("an edit in the field is done the line's way: typed, deleted, pasted", () => {
    const line = typed("1234");
    const insert = fromField({ ...line, selection: { start: 1, end: 1 } }, "15,234", EN_US);
    expect(insert.kind === "line" && insert.edited.line.text).toBe("15,234");
    // ⌫ over a grouping mark takes the digit before it, or nothing would change.
    const back = fromField({ ...line, selection: { start: 2, end: 2 } }, "1234", EN_US);
    expect(back.kind === "line" && back.edited.line.text).toBe("234");
    expect(fromField(line, "1,234=", EN_US)).toEqual({ kind: "equals" });
    expect(fromField(line, "1,234n", EN_US)).toEqual({ kind: "negate" });
    const pasted = fromField(line, "1,234 calc", EN_US);
    expect(pasted.kind === "line" && pasted.edited.note).toBe("refused-paste");
  });

  test("± changes the sign of the number at the caret", () => {
    const line = typed("12+3");
    expect(negate(line, EN_US).text).toBe("12 + −3");
    expect(negate(negate(line, EN_US), EN_US).text).toBe("12 + 3");
    expect(negate({ ...line, selection: { start: 1, end: 1 } }, EN_US).text).toBe("−12 + 3");
    expect(negate(EMPTY_LINE, EN_US).text).toBe("−");
  });

  test("the result under the line follows it, and stays quiet for a lone number", () => {
    expect(liveResult(typed("1250*12+340"), EN_US)).toMatchObject({ kind: "value", value: 15340 });
    expect(liveResult(typed("42"), EN_US)).toEqual({ kind: "none" });
    expect(resultWords(liveResult(typed("1250*12+340"), EN_US))).toEqual({ text: "= 15,340", tone: "result" });
    expect(resultWords(liveResult(typed("1/0"), EN_US))).toEqual({ text: "Can't divide by 0", tone: "error" });
  });
});

describe("=", () => {
  test("a sum goes to the tape; its result stands in the line, selected", () => {
    const { line, entry } = equals(typed("1250*12+340"), EN_US);
    expect(entry).toEqual({ expression: "1250 × 12 + 340", value: 15340 });
    expect(line.text).toBe("15,340");
    expect(line.selection).toEqual({ start: 0, end: 6 });
  });

  test("after =, an operator goes on from the result and a digit starts again", () => {
    const { line } = equals(typed("2+3"), EN_US);
    expect(typeChar(line, "+", EN_US).text).toBe("5 +");
    expect(typeChar(line, "7", EN_US).text).toBe("7");
  });

  test("= again repeats the last step", () => {
    const first = equals(typed("2+3"), EN_US);
    const second = equals(first.line, EN_US);
    expect(second.line.text).toBe("8");
    expect(second.entry).toEqual({ expression: "5 + 3", value: 8 });
  });

  test("going on from a result uses it exactly: 1 ÷ 3 = × 3 = is 1", () => {
    const third = equals(typed("1/3"), EN_US);
    expect(third.line.text).toBe("0.333333333333333");
    const times = typed("*3", third.line);
    expect(equals(times, EN_US).line.text).toBe("1");
  });

  test("a lone number is selected, not put on the tape; a broken sum stays", () => {
    expect(equals(typed("42"), EN_US).entry).toBeUndefined();
    const broken = typed("1/0");
    expect(equals(broken, EN_US).line).toBe(broken);
  });

  test("a sum from the tape comes back in the locale's marks", () => {
    expect(recall({ expression: "1250.5 × 2", value: 2501 }, DE).text).toBe("1.250,5 × 2");
  });
});

describe("state", () => {
  test("the keyboard and the keypad edit the same line, and the typed key lights", () => {
    const state = run([...keys("12"), { type: "key", id: "plus", locale: EN_US }, { type: "key", id: "3", locale: EN_US }]);
    expect(state.line.text).toBe("12 + 3");
    expect(run(keys("1")).lit).toBe("1");
  });

  test("= fills the tape; ↑ and ↓ walk it; Esc clears the line only", () => {
    let state = run([...keys("2"), { type: "field", text: "2+", locale: EN_US }]);
    state = run(
      [
        { type: "field", text: "2 +3", locale: EN_US },
        { type: "equals", locale: EN_US },
      ],
      state,
    );
    expect(state.tape).toEqual([{ expression: "2 + 3", value: 5 }]);
    state = run([{ type: "recall", step: 1, locale: EN_US }], state);
    expect(state.line.text).toBe("2 + 3");
    state = run([{ type: "recall", step: -1, locale: EN_US }], state);
    expect(state.line.text).toBe("");
    state = run([{ type: "clear" }], state);
    expect(state.tape).toHaveLength(1);
  });

  test("a result on the tape goes into the line at the caret", () => {
    const state = run([...keys("1"), { type: "field", text: "1+", locale: EN_US }, { type: "use", value: 15340, locale: EN_US }]);
    expect(state.line.text).toBe("1 + 15,340");
  });
});

describe("window size (LA-3)", () => {
  test("the minimum holds the keypad at its smallest; the tape widens the window by its own width", () => {
    expect(MIN_SIZE).toEqual({ width: 274, height: 440 });
    expect(openingSize(null, false)).toEqual(MIN_SIZE);
    expect(openingSize(null, true)).toEqual({ width: 274 + TAPE_WIDTH, height: 440 });
    expect(openingSize({ width: 100, height: 900 }, false)).toEqual({ width: 274, height: 900 });
    expect(sizeWithTape({ width: 400, height: 500 }, true)).toEqual({ width: 400 + TAPE_WIDTH, height: 500 });
    expect(sizeWithTape({ width: 300, height: 500 }, false)).toEqual({ width: 274, height: 500 });
  });

  test("the keys grow with the window", () => {
    expect(keySide(274, 440)).toBe(54);
    expect(keySide(600, 900)).toBeGreaterThan(54);
  });

  test("the line is as wide as its text, until it needs all the room", () => {
    expect(fieldWidth("12", 40, 246)).toBeLessThan(100);
    expect(fieldWidth("1,234,567,890,123 + 1", 22, 246)).toBe(246);
  });
});

describe("remembered", () => {
  test("the file keeps the tape, whether it shows, and the size; damage is a fresh start", () => {
    const dir = mkdtempSync(join(tmpdir(), "calc-store-"));
    try {
      const path = join(dir, "dashi", "calculator.json");
      writeRemembered({ tape: [{ expression: "2 + 3", value: 5 }], showsTape: true, size: { width: 498, height: 440 } }, path);
      expect(readRemembered(path)).toEqual({ tape: [{ expression: "2 + 3", value: 5 }], showsTape: true, size: { width: 498, height: 440 } });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
      writeFileSync(path, "{ broken");
      expect(readRemembered(path).tape).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("what isn't well formed is dropped; the tape keeps its last 200", () => {
    const parsed = parseRemembered({
      version: 1,
      tape: [{ expression: "1 + 1", value: 2 }, { expression: 3 }, "x"],
      showsTape: "yes",
      size: { width: 20, height: 400 },
    });
    expect(parsed).toEqual({ tape: [{ expression: "1 + 1", value: 2 }], showsTape: false, size: null });
    const long = Array.from({ length: TAPE_LIMIT + 5 }, (_, at) => ({ expression: `${at} + 0`, value: at }));
    expect(withEntry(long, { expression: "x", value: 1 })).toHaveLength(TAPE_LIMIT);
  });
});

describe("keys and menus", () => {
  test("a typed character lights its key", () => {
    expect(keyForChar("*", EN_US)).toBe("multiply");
    expect(keyForChar(",", DE)).toBe("decimal");
    expect(keyForChar(",", EN_US)).toBeNull();
    expect(keyForChar("n", EN_US)).toBe("negate");
  });

  test("Edit acts on the line; View shows the tape", () => {
    const ran: string[] = [];
    const actions = new Proxy({} as Parameters<typeof calculatorMenus>[0]["actions"], { get: (_target, name) => () => ran.push(String(name)) });
    const { menus, run: choose } = calculatorMenus({ hasSelection: false, canCopy: true, hasResult: true, showsTape: false, hasTape: false, actions });
    const labels = menus.flatMap((menu) => menu.items).flatMap((row) => (row.type === "separator" ? [] : [row.label]));
    expect(labels).toEqual(["Cut", "Copy", "Paste", "Select All", "Copy Result", "Clear", "Show Tape", "Clear Tape"]);
    choose("copy");
    choose("clear-tape");
    choose("copy-result");
    choose("tape");
    expect(ran).toEqual(["copyResult", "toggleTape"]);
  });
});
