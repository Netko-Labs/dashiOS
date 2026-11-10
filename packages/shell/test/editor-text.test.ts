import { describe, expect, test } from "bun:test";
import { decodeText, detectLineEnding, encodeText, normalizeLineEndings } from "../apps/editor/lib/codec.ts";
import { findMatches, lineOf, MATCH_LIMIT, matchAtOrAfter, replaceAll, stepMatch } from "../apps/editor/lib/find.ts";
import { apply, diff, History, invert, JOIN_MS, join } from "../apps/editor/lib/history.ts";
import { formatStats, textStats } from "../apps/editor/lib/stats.ts";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("codec", () => {
  test("UTF-8, with and without a byte-order mark", () => {
    expect(decodeText(utf8("héllo\n"))).toEqual({ text: "héllo\n", encoding: "utf-8", lineEnding: "lf" });
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x61))).toEqual({ text: "a", encoding: "utf-8-bom", lineEnding: "lf" });
  });

  test("bytes that aren't UTF-8 are Windows-1252: its quotes and dashes survive", () => {
    expect(decodeText(bytes(0x63, 0x61, 0x66, 0xe9))).toEqual({ text: "café", encoding: "windows-1252", lineEnding: "lf" });
    // Curly quotes, a dash and the euro sign from a Windows file, and a byte Windows-1252 leaves out.
    const windows = bytes(0x91, 0x69, 0x74, 0x92, 0x73, 0x20, 0x97, 0x20, 0x80, 0x81);
    const decoded = decodeText(windows);
    expect(decoded?.text).toBe("\u2018it\u2019s \u2014 \u20ac\u0081");
    expect(encodeText(decoded?.text ?? "", "windows-1252", "lf")).toEqual(windows);
    expect(encodeText("\u0100", "windows-1252", "lf")).toBeNull();
  });

  test("UTF-16 by its mark", () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x61, 0x00, 0x0a, 0x00))).toEqual({ text: "a\n", encoding: "utf-16le", lineEnding: "lf" });
    expect(decodeText(bytes(0xfe, 0xff, 0x00, 0x61))).toEqual({ text: "a", encoding: "utf-16be", lineEnding: "lf" });
  });

  test("NUL bytes without a UTF-16 mark are not text", () => {
    expect(decodeText(bytes(0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01))).toBeNull();
  });

  test("line endings are edited as \\n and the file's kind is remembered", () => {
    expect(decodeText(utf8("a\r\nb\r\n"))).toEqual({ text: "a\nb\n", encoding: "utf-8", lineEnding: "crlf" });
    expect(decodeText(utf8("a\rb"))?.lineEnding).toBe("cr");
    expect(detectLineEnding("a\r\nb\nc\r\nd")).toBe("crlf");
    expect(detectLineEnding("a\nb\r\n")).toBe("lf");
    expect(detectLineEnding("no newline")).toBe("lf");
    expect(normalizeLineEndings("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });

  test("encoding writes back what was read", () => {
    for (const original of [utf8("x\r\ny\r\n"), bytes(0xef, 0xbb, 0xbf, 0x61, 0x0a), bytes(0x63, 0x61, 0x66, 0xe9, 0x0d), bytes(0xff, 0xfe, 0x61, 0x00)]) {
      const decoded = decodeText(original);
      if (!decoded) throw new Error("not decoded");
      expect(encodeText(decoded.text, decoded.encoding, decoded.lineEnding)).toEqual(original);
    }
  });

  test("an encoding that can't hold a character says so", () => {
    expect(encodeText("€", "latin-1", "lf")).toBeNull();
    expect(encodeText("é", "latin-1", "lf")).toEqual(bytes(0xe9));
  });

  test("a large file decodes in chunks", () => {
    const big = new Uint8Array(100_000).fill(0xe9);
    expect(decodeText(big)?.text.length).toBe(100_000);
  });
});

describe("find", () => {
  test("matches are literal, case-insensitive by default, and don't overlap", () => {
    expect(findMatches("Aa aa a.a", "aa")).toEqual([0, 3]);
    expect(findMatches("Aa aa", "aa", { caseSensitive: true })).toEqual([3]);
    expect(findMatches("a.a axa", "a.a")).toEqual([0]);
    expect(findMatches("aaaa", "aa")).toEqual([0, 2]);
    expect(findMatches("anything", "")).toEqual([]);
  });

  test("a very common query stops counting", () => {
    expect(findMatches("a".repeat(MATCH_LIMIT + 50), "a")).toHaveLength(MATCH_LIMIT);
  });

  test("stepping wraps, and starts at an end", () => {
    expect(stepMatch(3, -1, 1)).toBe(0);
    expect(stepMatch(3, -1, -1)).toBe(2);
    expect(stepMatch(3, 2, 1)).toBe(0);
    expect(stepMatch(3, 0, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });

  test("the match at or after an offset", () => {
    expect(matchAtOrAfter([2, 8, 20], 8)).toBe(1);
    expect(matchAtOrAfter([2, 8, 20], 9)).toBe(2);
    expect(matchAtOrAfter([2, 8, 20], 30)).toBe(0);
    expect(matchAtOrAfter([], 0)).toBe(-1);
  });

  test("lines are counted from 1", () => {
    expect(lineOf("a\nb\nc", 0)).toBe(1);
    expect(lineOf("a\nb\nc", 2)).toBe(2);
    expect(lineOf("a\nb\nc", 4)).toBe(3);
  });

  test("Replace All takes the replacement literally", () => {
    expect(replaceAll("cat Cat cat", "cat", "$&-dog")).toEqual({ text: "$&-dog $&-dog $&-dog", count: 3 });
    expect(replaceAll("cat Cat", "cat", "x", { caseSensitive: true })).toEqual({ text: "x Cat", count: 1 });
    expect(replaceAll("same", "", "x")).toEqual({ text: "same", count: 0 });
  });
});

describe("history", () => {
  test("a change is the span between the common start and end", () => {
    expect(diff("hello world", "hello brave world")).toEqual({ at: 6, removed: "", inserted: "brave " });
    expect(diff("abc", "ac")).toEqual({ at: 1, removed: "b", inserted: "" });
    expect(diff("same", "same")).toBeNull();
    const change = diff("one two", "one 2") ?? { at: 0, removed: "", inserted: "" };
    expect(apply("one two", change)).toBe("one 2");
    expect(apply("one 2", invert(change))).toBe("one two");
  });

  test("typing on and deleting backwards join; anything else doesn't", () => {
    expect(join({ at: 0, removed: "", inserted: "ab" }, { at: 2, removed: "", inserted: "c" })).toEqual({ at: 0, removed: "", inserted: "abc" });
    expect(join({ at: 5, removed: "e", inserted: "" }, { at: 4, removed: "d", inserted: "" })).toEqual({ at: 4, removed: "de", inserted: "" });
    expect(join({ at: 0, removed: "", inserted: "ab" }, { at: 7, removed: "", inserted: "c" })).toBeNull();
    expect(join({ at: 0, removed: "", inserted: "ab" }, { at: 2, removed: "", inserted: "\n" })).toBeNull();
  });

  test("undo takes back a run of typing, redo puts it back", () => {
    const history = new History();
    history.record("", "h", 0);
    history.record("h", "hi", 100);
    history.record("hi", "hi there", 200 + JOIN_MS * 2);
    expect(history.undo("hi there")).toBe("hi");
    expect(history.undo("hi")).toBe("");
    expect(history.canUndo).toBe(false);
    expect(history.redo("")).toBe("hi");
    expect(history.redo("hi")).toBe("hi there");
    expect(history.redo("hi there")).toBeNull();
  });

  test("a new change drops what could be redone; a step that isn't joinable stays its own", () => {
    const history = new History();
    history.record("", "a", 0);
    expect(history.undo("a")).toBe("");
    history.record("", "b", 10);
    expect(history.canRedo).toBe(false);
    history.record("b", "bc", 20, false);
    history.record("bc", "bcd", 30);
    expect(history.undo("bcd")).toBe("bc");
  });

  test("the oldest changes go past the limit", () => {
    const history = new History(2);
    history.record("", "a", 0, false);
    history.record("a", "ab", 0, false);
    history.record("ab", "abc", 0, false);
    expect(history.undo("abc")).toBe("ab");
    expect(history.undo("ab")).toBe("a");
    expect(history.undo("a")).toBeNull();
  });
});

describe("stats", () => {
  test("lines, words, characters", () => {
    // An empty document has the line its caret is on.
    expect(textStats("")).toEqual({ lines: 1, words: 0, characters: 0 });
    expect(textStats("one two\nthree\n")).toEqual({ lines: 2, words: 3, characters: 14 });
    expect(textStats("a\n\nb")).toEqual({ lines: 3, words: 2, characters: 4 });
    expect(textStats("👋").characters).toBe(1);
    expect(formatStats({ lines: 1, words: 1200, characters: 2 })).toBe("1 line · 1,200 words · 2 characters");
  });
});
