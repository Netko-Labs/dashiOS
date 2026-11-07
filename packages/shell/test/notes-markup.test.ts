import { describe, expect, test } from "bun:test";
import { lightColors } from "@dashi/ui";
import { findMatches, nextMatch } from "../apps/notes/find.ts";
import { BODY_SIZE, lineSizes, lookOf } from "../apps/notes/look.ts";
import { markup, type Span, spanAt } from "../apps/notes/markup.ts";

/** The spans of `body` as [kind, the text they cover]. */
const covered = (body: string): Array<[string, string]> => markup(body).map((span: Span) => [span.kind, body.slice(span.start, span.end)]);

describe("markup: what the live page draws differently", () => {
  test("a heading is sized, its marker faded", () => {
    expect(markup("## Plan")).toEqual([
      { kind: "heading", start: 0, end: 7, level: 2 },
      { kind: "marker", start: 0, end: 3 },
    ]);
    // No space after the hashes: a tag, not a heading.
    expect(covered("#tag")).toEqual([]);
  });

  test("bold, italic, code, struck: the words and both markers", () => {
    expect(covered("a **big** *small* `x` ~~gone~~ b")).toEqual([
      ["bold", "**big**"],
      ["marker", "**"],
      ["marker", "**"],
      ["italic", "*small*"],
      ["marker", "*"],
      ["marker", "*"],
      ["code", "`x`"],
      ["marker", "`"],
      ["marker", "`"],
      ["strike", "~~gone~~"],
      ["marker", "~~"],
      ["marker", "~~"],
    ]);
    // Stars inside code are code, not italic; snake_case is not italic.
    expect(covered("`a*b*c` snake_case_name")).toEqual([
      ["code", "`a*b*c`"],
      ["marker", "`"],
      ["marker", "`"],
    ]);
    expect(covered("2 * 3 * 4")).toEqual([]);
  });

  test("a checklist item: its box takes a press, and a ticked one's words are struck", () => {
    const body = "- [ ] milk\n  - [x] eggs";
    const spans = markup(body);
    expect(spans).toContainEqual({ kind: "box", start: 2, end: 5, line: 0, checked: false });
    expect(spans).toContainEqual({ kind: "box", start: 15, end: 18, line: 1, checked: true });
    expect(covered(body)).toContainEqual(["done", "eggs"]);
    expect(covered(body)).not.toContainEqual(["done", "milk"]);
    expect(spanAt(spans, "box", 16)).toMatchObject({ line: 1 });
    expect(spanAt(spans, "box", 8)).toBeNull();
  });

  test("a link's words, its address faded; a bare address is a link too", () => {
    const body = "see [the plan](https://example.org/plan) or https://example.org.";
    expect(covered(body)).toEqual([
      ["marker", "["],
      ["link", "the plan"],
      ["marker", "](https://example.org/plan)"],
      ["link", "https://example.org"],
    ]);
    expect(markup(body)[1]).toMatchObject({ url: "https://example.org/plan" });
  });

  test("fenced lines are code, and nothing in them is formatted", () => {
    expect(covered("```\n# not a heading\n```\n**b**")).toEqual([
      ["marker", "```"],
      ["code", "# not a heading"],
      ["marker", "```"],
      ["bold", "**b**"],
      ["marker", "**"],
      ["marker", "**"],
    ]);
  });

  test("bullets, numbers, quotes and rules", () => {
    expect(covered("- one\n2. two\n> said\n---")).toEqual([
      ["marker", "- "],
      ["marker", "2. "],
      ["quote", "> said"],
      ["marker", "> "],
      ["marker", "---"],
    ]);
  });
});

describe("look: the spans as a field's runs", () => {
  test("markers fade, headings take TY-1's sizes, boxes and links take presses, matches are washed", () => {
    const body = "# Title\n- [x] done [a](https://a.b)";
    const look = lookOf(markup(body), lightColors, findMatches(body, "title"));
    expect(look.runs[0]).toMatchObject({ start: 0, end: 7, fontWeight: "bold", fontSize: 20 });
    expect(look.runs[1]).toMatchObject({ color: lightColors.textDisabled });
    const pressed = [...look.pressable.entries()].map(([index, span]) => [look.runs[index]?.press, span.kind]);
    expect(pressed).toEqual([
      [true, "box"],
      [true, "link"],
    ]);
    const box = [...look.pressable.entries()].find(([, span]) => span.kind === "box")?.[0] ?? -1;
    expect(look.runs[box]?.color).toBe(lightColors.moss);
    expect(look.runs.at(-1)).toEqual({ start: 2, end: 7, backgroundColor: lightColors.brothWash });
  });

  test("the measuring copy sizes each line as the field draws it", () => {
    expect(lineSizes("# A\nb\n```\n# c\n```")).toEqual([
      { text: "# A", size: 20 },
      { text: "b", size: BODY_SIZE },
      { text: "```", size: BODY_SIZE },
      { text: "# c", size: BODY_SIZE },
      { text: "```", size: BODY_SIZE },
    ]);
  });
});

describe("find in the note", () => {
  test("every word of the search, case and accents ignored, in order", () => {
    const body = "Café and CAFE, then a cafeteria";
    expect(findMatches(body, "cafe").map((match) => body.slice(match.start, match.end))).toEqual(["Café", "CAFE", "cafe"]);
    expect(findMatches(body, "  ")).toEqual([]);
  });

  test("next and previous wrap around", () => {
    const matches = [
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ];
    expect(nextMatch(matches, { start: 0, end: 2 }, 1)).toEqual({ start: 5, end: 7 });
    expect(nextMatch(matches, { start: 5, end: 7 }, 1)).toEqual({ start: 0, end: 2 });
    expect(nextMatch(matches, { start: 3, end: 3 }, -1)).toEqual({ start: 0, end: 2 });
    expect(nextMatch(matches, { start: 0, end: 0 }, -1)).toEqual({ start: 5, end: 7 });
    expect(nextMatch([], { start: 0, end: 0 }, 1)).toBeNull();
  });
});
