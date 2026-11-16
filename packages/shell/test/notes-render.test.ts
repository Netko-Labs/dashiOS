import { describe, expect, test } from "bun:test";
import { lightColors } from "@dashi/ui";
import { blocksOf, revealedLines } from "../apps/notes/lib/blocks.ts";
import { lookOf } from "../apps/notes/lib/look.ts";
import { displaySelection, sourceEdit, sourceSelection, toDisplay } from "../apps/notes/lib/offsets.ts";
import { project } from "../apps/notes/lib/project.ts";
import { indentLines, structure, tickLines } from "../apps/notes/lib/structure.ts";
import { columnsOf, parseTable, splitRow } from "../apps/notes/lib/table.ts";

const NOTE = [
  "# Plan",
  "Some **bold**, *italic*, `code` and [a link](https://example.org).",
  "- milk",
  "  - eggs",
  "1. first",
  "- [ ] call Alex",
  "- [x] done",
  "> a quote",
  "---",
  "```ts",
  "const a = 1;",
  "```",
  "| Scenario | Model | Tokens | Cost |",
  "| --- | --- | ---: | ---: |",
  "| Light | Haiku | 1,000 | $0.01 |",
  "| Heavy | Opus | 90,000 | $4.20 |",
  "after",
].join("\n");

const lines = (text: string): string[] => text.split("\n");

describe("blocks: what one caret reveals", () => {
  test("a code block and a table are one block each; every other line is its own", () => {
    expect(blocksOf(lines(NOTE)).map((block) => `${block.kind} ${block.from}-${block.to}`)).toEqual([
      ...Array.from({ length: 9 }, (_, line) => `line ${line}-${line}`),
      "fence 9-11",
      "table 12-15",
      "line 16-16",
    ]);
  });

  test("the caret's block shows its source; a selection, every block it touches", () => {
    const at = (text: string): number => NOTE.indexOf(text);
    expect(revealedLines(NOTE, at("milk"), at("milk"))).toEqual({ from: 2, to: 2 });
    expect(revealedLines(NOTE, at("const"), at("const"))).toEqual({ from: 9, to: 11 });
    expect(revealedLines(NOTE, at("Heavy"), at("Heavy"))).toEqual({ from: 12, to: 15 });
    expect(revealedLines(NOTE, at("milk"), at("first"))).toEqual({ from: 2, to: 4 });
    // A caret at a line's end is on that line, not the next.
    expect(revealedLines("a\nb", 1, 1)).toEqual({ from: 0, to: 0 });
  });

  test("an unclosed fence runs to the end; pipes without a dashes row are words", () => {
    expect(blocksOf(["```", "x", "y"])).toEqual([{ kind: "fence", from: 0, to: 2 }]);
    expect(blocksOf(["a | b", "c | d"]).map((block) => block.kind)).toEqual(["line", "line"]);
  });
});

describe("tables", () => {
  test("cells, alignment, and a pipe inside a cell", () => {
    expect(splitRow("| a | b \\| c |")).toEqual(["a", "b | c"]);
    const table = parseTable(lines(NOTE).slice(12, 16));
    expect(table.header).toEqual(["Scenario", "Model", "Tokens", "Cost"]);
    expect(table.align).toEqual(["left", "left", "right", "right"]);
    expect(table.rows[1]).toEqual(["Heavy", "Opus", "90,000", "$4.20"]);
    expect(parseTable(["| a | b |", "|:-:|-|", "| only |"]).rows).toEqual([["only", ""]]);
    expect(columnsOf(table)).toEqual([
      { weight: 8, floor: 8 },
      { weight: 5, floor: 5 },
      { weight: 6, floor: 6 },
      { weight: 5, floor: 5 },
    ]);
  });
});

describe("project: the note drawn as what it means", () => {
  test("with no caret, markers go and every block is drawn", () => {
    const shown = lines(project(NOTE, null).display);
    expect(shown.slice(0, 9)).toEqual([
      "Plan",
      "Some bold, italic, code and a link.",
      "• milk",
      "  • eggs",
      "1. first",
      "□ call Alex",
      "■ done",
      "a quote",
      " ",
    ]);
    // The code block's fences: its language, then nothing; a table's rows keep their places as spaces.
    expect(shown.slice(9, 17)).toEqual(["ts", "const a = 1;", "", " ", " ", " ", " ", "after"]);
  });

  test("the caret's line shows its Markdown and nothing else changes", () => {
    const projection = project(NOTE, { from: 0, to: 0 });
    expect(lines(projection.display)[0]).toBe("# Plan");
    expect(lines(projection.display)[2]).toBe("• milk");
    const table = project(NOTE, { from: 12, to: 15 });
    expect(lines(table.display).slice(12, 16)).toEqual(lines(NOTE).slice(12, 16));
  });

  test("paragraphs carry their size and what is drawn under them", () => {
    const { paras, tables } = project(NOTE, null);
    expect(paras.length).toBe(lines(NOTE).length);
    expect(paras[0]).toMatchObject({ size: 20, bold: true });
    expect(paras[7]?.deco).toBe("quote");
    expect(paras[8]?.deco).toBe("rule");
    expect(paras.slice(9, 12).map((para) => para.deco)).toEqual(["code", "code", "code"]);
    expect(paras.slice(12, 16).every((para) => para.deco === "table" && para.group === 0)).toBe(true);
    expect(tables).toHaveLength(1);
  });

  test("runs: bold where the bold words are drawn, a box that takes a press, a table's rows sized to it", () => {
    const projection = project(NOTE, null);
    const look = lookOf(projection.spans, lightColors, [], (_table, rows) => 40 / rows);
    const text = projection.display;
    const bold = look.runs.find((run) => run.fontWeight === "bold" && run.fontSize === undefined);
    expect(bold && text.slice(bold.start, bold.end)).toBe("bold");
    const boxes = [...look.pressable.values()].filter((span) => span.kind === "box");
    expect(boxes.map((span) => [text.slice(span.start, span.end), span.line])).toEqual([
      ["□", 5],
      ["■", 6],
    ]);
    const link = [...look.pressable.values()].find((span) => span.kind === "link");
    expect(link && [text.slice(link.start, link.end), link.kind === "link" && link.url]).toEqual(["a link", "https://example.org"]);
    expect(look.runs.filter((run) => run.fontSize === 10)).toHaveLength(4);
  });
});

describe("offsets: the drawn page and its Markdown", () => {
  const body = "## Plan\nbuy **milk** now";
  const projection = project(body, null);

  test("a caret in drawn words is in their source; a selection of drawn words is their source, markers kept outside", () => {
    expect(projection.display).toBe("Plan\nbuy milk now");
    expect(sourceSelection(projection.pieces, { start: 0, end: 0 })).toEqual({ start: 3, end: 3 });
    const milk = projection.display.indexOf("milk");
    expect(sourceSelection(projection.pieces, { start: milk, end: milk + 4 })).toEqual({ start: 14, end: 18 });
    expect(displaySelection(projection.pieces, { start: 14, end: 18 })).toEqual({ start: milk, end: milk + 4 });
    expect(toDisplay(projection.pieces, body.length)).toBe(projection.display.length);
  });

  test("typing over drawn words edits the Markdown under them", () => {
    const milk = projection.display.indexOf("milk");
    const typed = projection.display.replace("milk", "bread");
    expect(sourceEdit(body, projection.pieces, projection.display, typed, { start: milk, end: milk + 4 })).toBe("## Plan\nbuy **bread** now");
    // Deleting across lines takes the markers between with it.
    const joined = `Pl${projection.display.slice(projection.display.indexOf("milk"))}`;
    expect(sourceEdit(body, projection.pieces, projection.display, joined, { start: 2, end: milk })).toBe("## Pl**milk** now");
  });

  test("typing on the caret's line is typing in the Markdown", () => {
    const shown = project(body, { from: 1, to: 1 });
    expect(lines(shown.display)[1]).toBe("buy **milk** now");
    const at = shown.display.length;
    expect(sourceEdit(body, shown.pieces, shown.display, `${shown.display}!`, { start: at, end: at })).toBe(`${body}!`);
    // "a" typed after "a": the change is where the caret was, not the first place it could be.
    const aa = project("aa", { from: 0, to: 0 });
    expect(sourceEdit("aa", aa.pieces, aa.display, "aaa", { start: 1, end: 1 })).toBe("aaa");
  });

  test("a table's row placeholder is the whole row's source", () => {
    const table = project("| a | b |\n|---|---|\n| 1 | 2 |", null);
    expect(table.display).toBe(" \n \n ");
    expect(sourceSelection(table.pieces, { start: 4, end: 4 })).toEqual({ start: 20, end: 20 });
  });
});

describe("typing makes structure", () => {
  test("[] and a space: a checklist item", () => {
    expect(structure("x\n[]", "x\n[] ", 4)).toEqual({ body: "x\n- [ ] ", selection: { start: 8, end: 8 } });
    expect(structure("  - []", "  - [] ", 6)?.body).toBe("  - [ ] ");
    expect(structure("a []", "a [] ", 4)).toBeNull();
  });

  test("Tab in a list item indents it under its words; in other words it is a tab", () => {
    expect(structure("- milk", "- mi\tlk", 4)).toEqual({ body: "  - milk", selection: { start: 6, end: 6 } });
    expect(structure("1. one", "1. one\t", 6)?.body).toBe("   1. one");
    expect(structure("words", "wo\trds", 2)).toBeNull();
  });

  test("Return after an opening fence closes it below; after a closing one it does nothing", () => {
    expect(structure("```ts", "```ts\n", 5)).toEqual({ body: "```ts\n\n```", selection: { start: 6, end: 6 } });
    expect(structure("```\nx\n```", "```\nx\n```\n", 9)).toBeNull();
    expect(structure("```\n\n```", "```\n\n\n```", 3)).toBeNull();
  });

  test("Indent and Outdent move each line a level and keep the caret on its words", () => {
    expect(indentLines("- a\n- b", { start: 2, end: 6 }, 1)).toEqual({ body: "  - a\n  - b", selection: { start: 4, end: 10 } });
    expect(indentLines("  - a", { start: 4, end: 4 }, -1)).toEqual({ body: "- a", selection: { start: 2, end: 2 } });
    expect(indentLines("- a", { start: 2, end: 2 }, -1).body).toBe("- a");
  });

  test("Mark as Done ticks the selected items, or unticks them when all are", () => {
    expect(tickLines("- [ ] a\nwords\n- [x] b", { start: 0, end: 20 }).body).toBe("- [x] a\nwords\n- [x] b");
    expect(tickLines("- [x] a\n  * [X] b", { start: 0, end: 14 }).body).toBe("- [ ] a\n  * [ ] b");
    expect(tickLines("plain", { start: 2, end: 2 }).body).toBe("plain");
  });
});
