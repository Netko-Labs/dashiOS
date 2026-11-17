/**
 * A launcher detail (a pull request's body; launcher/lib/detail-view.tsx):
 * it scrolls, by the wheel and by the launcher's keys; a table wider than
 * the column scrolls sideways at its least width, its cells wrapped; `---`
 * is a rule; a quote has its bar, and GitHub's alerts their word. Pass 39
 * saw long bodies cut, tables cut at the right, rules and alerts as text.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { parseTree, type ViewNode } from "@dashi/applet";
import type { TreeActed, TreeSnapshot, TreeView } from "../src/actions/index.ts";
import { inline, markdownBlocks } from "../src/launcher/lib/detail-markdown.ts";
import { DetailScroll, detailScroll } from "../src/launcher/lib/detail-scroll.ts";
import { treeScope } from "../src/launcher/lib/tree-scope.ts";
import { leastWidth, parseTable } from "../src/shared/markdown/index.ts";
import { mount, unmountLauncher } from "./launcher-harness.tsx";

afterEach(() => unmountLauncher());

function tree(value: unknown): ViewNode {
  const parsed = parseTree(value);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

/** One view: a detail with `markdown`. */
class OneDetail implements TreeView {
  readonly from = "GitHub";
  readonly dir = null;
  private readonly state: TreeSnapshot;
  constructor(markdown: string) {
    this.state = { stack: [tree({ t: "Detail", i: "d", p: { markdown } })], phase: "shown", since: 0 };
  }
  subscribe = () => () => {};
  snapshot = () => this.state;
  search = () => {};
  select = () => {};
  more = () => {};
  act = async () => ({ kind: "done" as const });
  setPreference = async () => true;
  connect = async (): Promise<TreeActed> => ({ kind: "done" });
  change = (): void => {};
  back = () => false;
  close = () => {};
}

const open = async (markdown: string) => {
  const scope = treeScope("Pull Requests", new OneDetail(markdown));
  const launcher = await mount({ entries: [], scopes: [scope], scope: scope.id }, []);
  await launcher.type("");
  return launcher;
};

describe("the detail's Markdown", () => {
  test("`---`, `***` and `___` are rules; under a paragraph, `---` and `===` underline a heading", () => {
    expect(markdownBlocks("One.\n\n---\n\nTwo.\n\n* * *\n\n___").map((block) => block.kind)).toEqual(["p", "rule", "p", "rule", "rule"]);
    expect(markdownBlocks("Summary\n---\nBody.\n\nTitle\n===")).toEqual([
      { kind: "h2", text: "Summary" },
      { kind: "p", text: "Body." },
      { kind: "h1", text: "Title" },
    ]);
    // A list item is not a rule.
    expect(markdownBlocks("- one\n- two").map((block) => block.kind)).toEqual(["li", "li"]);
  });

  test("a quote is one block of paragraphs; GitHub's alerts keep their kind, not their marker", () => {
    expect(markdownBlocks("> It flickered\n> on resume.\n>\n> **Twice**.")).toEqual([{ kind: "quote", text: "It flickered on resume.\nTwice." }]);
    expect(markdownBlocks("> [!WARNING]\n> This drops the cache.\n\nAfter.")).toEqual([
      { kind: "quote", text: "This drops the cache.", alert: "warning" },
      { kind: "p", text: "After." },
    ]);
    const kinds = ["NOTE", "TIP", "IMPORTANT", "CAUTION", "note"].map((word) => markdownBlocks(`> [!${word}]\n> x`)[0]);
    expect(kinds.map((block) => (block && "alert" in block ? block.alert : null))).toEqual(["note", "tip", "important", "caution", "note"]);
    // An unknown word is a plain quote with the word in it.
    expect(markdownBlocks("> [!HELLO]\n> x")).toEqual([{ kind: "quote", text: "[!HELLO] x" }]);
  });

  test("drawn: the rule as a line, the alert with its word, nothing of `[!` or `---` left", async () => {
    const launcher = await open("## Summary\n\n> [!WARNING]\n> This drops the cache.\n\n---\n\nThe rest.");
    expect(launcher.has("launcher:detail:rule")).toBe(true);
    expect(launcher.has("launcher:detail:quote")).toBe(true);
    const drawn = launcher.tree();
    expect(drawn).toContain('"Warning"');
    expect(drawn).toContain('"This drops the cache."');
    expect(drawn).not.toContain("[!WARNING]");
    expect(drawn).not.toContain('"---"');
  });
});

describe("a long detail", () => {
  const Long = Array.from({ length: 60 }, (_, at) => `Line ${at + 1} of the body.`).join("\n\n");

  test("its words are in a view that scrolls, all of them drawn", async () => {
    const launcher = await open(Long);
    expect(launcher.tree()).toMatch(/"flex":1,"scroll":true/);
    expect(launcher.tree()).toContain('"Line 60 of the body."');
  });

  test("↓ and ↑ scroll it and leave the selection where it was", async () => {
    const launcher = await open(Long);
    const moved: Array<number | undefined> = [];
    detailScroll.attach({ scrollTo: (offset) => moved.push(offset.y), scrollToEnd: () => moved.push(-1) });
    detailScroll.scrolled({ contentOffset: { x: 0, y: 0 }, contentSize: { width: 300, height: 2000 }, layoutMeasurement: { width: 300, height: 400 } });
    await launcher.key("ArrowDown");
    await launcher.key("ArrowDown");
    await launcher.key("ArrowUp");
    expect(moved).toEqual([48, 96, 48]);
  });
});

test("the keys' steps: a page is the view less half a step; never above the top or past the end", () => {
  const scroll = new DetailScroll();
  expect(scroll.step("down")).toBe(false);
  const to: Array<number | undefined> = [];
  scroll.attach({ scrollTo: (offset) => to.push(offset.y), scrollToEnd: () => to.push(-1) });
  scroll.scrolled({ contentOffset: { x: 0, y: 0 }, contentSize: { width: 300, height: 1000 }, layoutMeasurement: { width: 300, height: 400 } });
  for (const how of ["up", "page-down", "page-down", "page-down", "first", "last"] as const) scroll.step(how);
  expect(to).toEqual([0, 376, 600, 600, 0, -1]);
});

describe("a table wider than the column", () => {
  const Wide = [
    "| Package | Change | Age | Adoption | Passing | Confidence |",
    "| --- | --- | --- | --- | --- | --- |",
    "| typescript | 5.8.3 → 5.9.2 | 2 days | 92% | 100% | high |",
  ];

  test("is drawn at its least width, each column at its longest word, and scrolls sideways", async () => {
    const launcher = await open(`Before.\n\n${Wide.join("\n")}`);
    const least = leastWidth(parseTable(Wide), 12 * 0.58, 12);
    expect(least).toBeGreaterThan(400);
    expect(launcher.tree()).toMatch(
      new RegExp(`"scrollX":true,"onLayout":true\\},"children":\\[\\{"type":"view","props":\\{"id":"\\d+","direction":"column","width":${least},`),
    );
  });
});

// The VM (renovatebot/renovate#47608): each column was as wide as its link's address, so four short columns ran off the side.
test("a column is measured by its words as drawn, not by its links' addresses", () => {
  const Renovate = [
    "| Package | Change | [Age](https://docs.renovatebot.com/merge-confidence/) | [Confidence](https://docs.renovatebot.com/merge-confidence/) |",
    "|---|---|---|---|",
    "| [glob](https://github.com/isaacs/node-glob) | [`13.0.6` → `14.0.2`](https://renovatebot.com/diffs/npm/glob/13.0.6/14.0.2) | ![age](https://developer.mend.io/api/mc/badges/age/npm/glob/14.0.2?slim=true) | ![confidence](https://developer.mend.io/api/mc/badges/confidence/npm/glob/13.0.6/14.0.2?slim=true) |",
  ];
  const table = parseTable(Renovate);
  const drawn = leastWidth(table, 12 * 0.58, 12, inline);
  expect(drawn).toBeLessThan(leastWidth(table, 12 * 0.58, 12));
  // Four columns of short words fit beside the facts (the column is about 376 wide at the launcher's 620).
  expect(drawn).toBeLessThan(376);
});
