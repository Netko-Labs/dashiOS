import { describe, expect, test } from "bun:test";
import { initialTicks, listOutput, rowsFrom, shownColumns } from "../apps/dialog/lib/list.ts";
import { applyProgressLine, endProgress, initialProgress, parseProgressLine, timeRemaining } from "../apps/dialog/lib/progress.ts";

describe("progress lines", () => {
  test("numbers, text, pulsate, and anything else", () => {
    expect(parseProgressLine("42")).toEqual({ kind: "percentage", value: 42 });
    expect(parseProgressLine(" 12.5 ")).toEqual({ kind: "percentage", value: 12.5 });
    expect(parseProgressLine("150")).toEqual({ kind: "percentage", value: 100 });
    expect(parseProgressLine("50%")).toEqual({ kind: "percentage", value: 50 });
    expect(parseProgressLine("# Copying files")).toEqual({ kind: "text", text: "Copying files" });
    expect(parseProgressLine("#")).toEqual({ kind: "text", text: "" });
    expect(parseProgressLine("pulsate:true")).toEqual({ kind: "pulsate", on: true });
    expect(parseProgressLine("pulsate:FALSE")).toEqual({ kind: "pulsate", on: false });
    expect(parseProgressLine("hello")).toBeNull();
    expect(parseProgressLine("")).toBeNull();
  });

  const plain = { autoClose: false, noMarkup: false };
  const closing = { autoClose: true, noMarkup: false };

  test("100% enables OK; with --auto-close it closes", () => {
    let state = initialProgress(0, "Running...", false);
    state = applyProgressLine(state, "50", plain);
    expect(state).toMatchObject({ percentage: 50, finished: false, close: false });
    state = applyProgressLine(state, "# <b>Almost</b> done", plain);
    expect(state.text).toBe("Almost done");
    expect(applyProgressLine(state, "100", plain)).toMatchObject({ finished: true, close: false });
    expect(applyProgressLine(state, "100", closing)).toMatchObject({ finished: true, close: true });
  });

  test("the end of stdin enables OK, fills a pulsing bar, and closes with --auto-close", () => {
    const state = initialProgress(30, "", true);
    expect(endProgress(state, plain)).toMatchObject({ percentage: 100, pulsate: false, finished: true, close: false });
    expect(endProgress(initialProgress(30, "", false), plain)).toMatchObject({ percentage: 30, finished: true });
    expect(endProgress(state, closing).close).toBe(true);
  });

  test("time remaining", () => {
    expect(timeRemaining(10_000, 0)).toBeNull();
    expect(timeRemaining(500, 50)).toBeNull();
    expect(timeRemaining(10_000, 50)).toBe("Time remaining: 00:00:10");
    expect(timeRemaining(3_600_000, 25)).toBe("Time remaining: 03:00:00");
  });
});

describe("list", () => {
  test("cells into rows, a short last row padded", () => {
    expect(rowsFrom(["a", "1", "b", "2", "c"], 2)).toEqual([
      { id: 0, cells: ["a", "1"] },
      { id: 1, cells: ["b", "2"] },
      { id: 2, cells: ["c", ""] },
    ]);
    expect(rowsFrom(["a"], 0)).toEqual([]);
  });

  test("ticks a checklist or radiolist starts with", () => {
    const rows = rowsFrom(["TRUE", "a", "false", "b", "true", "c"], 2);
    expect([...initialTicks(rows, "checklist")]).toEqual([0, 2]);
    expect([...initialTicks(rows, "radiolist")]).toEqual([0]);
  });

  const rows = rowsFrom(["apple", "red", "1", "banana", "yellow", "2", "cherry", "red", "3"], 3);

  test("the first column of the chosen row, by default", () => {
    expect(listOutput(rows, new Set([1]), { printColumns: [1], separator: "|", toggles: false })).toBe("banana\n");
    expect(listOutput(rows, new Set(), { printColumns: [1], separator: "|", toggles: false })).toBeNull();
  });

  test("several rows and columns, in the list's order, joined by the separator", () => {
    expect(listOutput(rows, new Set([2, 0]), { printColumns: [1], separator: "|", toggles: false })).toBe("apple|cherry\n");
    expect(listOutput(rows, new Set([0]), { printColumns: "all", separator: ",", toggles: false })).toBe("apple,red,1\n");
    expect(listOutput(rows, new Set([0, 1]), { printColumns: [3, 1], separator: "\n", toggles: false })).toBe("1\napple\n2\nbanana\n");
    expect(listOutput(rows, new Set([0]), { printColumns: [9], separator: "|", toggles: false })).toBe("\n");
  });

  test("a checklist prints its data columns; ALL leaves the tick out", () => {
    const checks = rowsFrom(["TRUE", "Steam", "stable", "FALSE", "Beta", "beta"], 3);
    expect(listOutput(checks, new Set([0, 1]), { printColumns: [2], separator: "|", toggles: true })).toBe("Steam|Beta\n");
    expect(listOutput(checks, new Set([1]), { printColumns: "all", separator: "|", toggles: true })).toBe("Beta|beta\n");
    expect(listOutput(checks, new Set([1]), { printColumns: [1], separator: "|", toggles: true })).toBe("TRUE\n");
  });

  test("hidden columns", () => {
    expect(shownColumns(3, [])).toEqual([0, 1, 2]);
    expect(shownColumns(3, [2])).toEqual([0, 2]);
  });
});
