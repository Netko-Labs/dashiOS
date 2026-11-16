import { describe, expect, test } from "bun:test";
import { readItems } from "../browser-extension/src/page/items.ts";
import { isLandmark, pickMain } from "../browser-extension/src/page/main.ts";
import { readFrame } from "../browser-extension/src/page/read.ts";
import { renumber } from "../browser-extension/src/page/refs.ts";
import { findInPage, itemRows, moreWords, pageWords, partOf } from "../src/agents/desktop/lib/page-parts.ts";
import { parseCall } from "../src/agents/index.ts";
import { node, numbering, type Spec } from "./support/page-nodes.ts";

const plain = (text: string) => renumber(text, (local) => local);
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

const article: Spec = {
  tag: "body",
  children: [
    { tag: "nav", children: [{ tag: "a", href: "https://x.example/", attrs: { href: "/" }, children: ["Home"] }, " Menu"] },
    {
      tag: "div",
      children: [
        { tag: "h1", children: ["The story"] },
        { tag: "p", children: [words(200)] },
        { tag: "aside", children: ["Suggested for you"] },
      ],
    },
    { tag: "footer", children: ["Terms Privacy Cookies"] },
  ],
};

describe("read_page's main content", () => {
  test("without <main>, the block holding most of the text, menus, sidebars and footers left out", () => {
    const root = pickMain(node(article));
    const { text } = readFrame(root, numbering(), undefined, null, isLandmark);
    expect(text).toContain("# The story");
    expect(text).not.toContain("Suggested");
    expect(text).not.toContain("Terms");
    expect(text).not.toContain("Menu");
  });

  test("a page's own <main> wins", () => {
    const page: Spec = {
      tag: "body",
      children: [
        { tag: "div", children: [words(300)] },
        { tag: "main", children: [{ tag: "p", children: ["Short main"] }] },
      ],
    };
    expect(readFrame(pickMain(node(page)), numbering()).text).toBe("Short main");
  });
});

const card = (title: string, price: string, place: string, id: number): Spec => ({
  tag: "div",
  attrs: { class: "card x1" },
  children: [
    {
      tag: "a",
      href: `https://shop.example/item/${id}`,
      attrs: { href: `/item/${id}` },
      children: [
        { tag: "div", children: [price] },
        { tag: "div", children: [title] },
        { tag: "div", children: [place] },
      ],
    },
  ],
});

describe("read_page's items", () => {
  test("a grid of listings becomes rows: title, price, details, the link and its number", () => {
    const page: Spec = {
      tag: "body",
      children: [
        {
          tag: "nav",
          children: [1, 2, 3, 4].map((i) => ({
            tag: "li",
            children: [{ tag: "a", href: `https://shop.example/c${i}`, attrs: { href: "x" }, children: [`C${i}`] }],
          })),
        },
        {
          tag: "div",
          children: [card("Bike, 26 inch", "$120", "Bogotá, DC", 1), card("Desk lamp", "COP 45.000", "Medellín", 2), card("Old guitar", "Free", "Cali", 3)],
        },
      ],
    };
    const items = readItems(node(page), numbering(), "https://shop.example");
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ ref: expect.any(Number), title: "Bike, 26 inch", price: "$120", href: "/item/1", details: ["Bogotá, DC"] });
    expect(items[1]).toMatchObject({ title: "Desk lamp", price: "COP 45.000" });
    expect(itemRows(items.slice(0, 1))).toMatch(/^1\. \[\d+\] "Bike, 26 inch" · \$120 · Bogotá, DC → \/item\/1$/);
  });

  test("no list of three is no items", () => {
    expect(readItems(node(article), numbering())).toEqual([]);
  });
});

describe("parts, a cursor, and find", () => {
  const page = Array.from({ length: 400 }, (_, i) => `Line ${i} ${"x".repeat(40)}`).join("\n");

  test("a part ends at a line, says how much it is, and the cursor goes on from there", () => {
    const first = partOf(page, 0, 1000);
    expect(first.text.endsWith("\n")).toBe(true);
    expect(first.next).toBe(first.text.length);
    expect(moreWords(first, 0)).toContain(`read_page with cursor ${first.next}`);
    const last = partOf(page, page.length - 10, 1000);
    expect(last.next).toBeNull();
  });

  test("find gives the lines around each match, joined when they touch", () => {
    const found = findInPage("a\nb\nPrice: 10\nc\nd\ne\nf\ng\nh\nprice: 20\ni", "PRICE", 1);
    expect(found).toEqual({ text: "b\nPrice: 10\nc\n…\nh\nprice: 20\ni", matches: 2 });
  });

  test("the default is the whole page, capped, with the line that says how to get the rest", () => {
    const call = parseCall({ name: "read_page", arguments: {} });
    expect(call).toEqual({ name: "read_page", tab: null, mode: "all", find: null, cursor: 0, maxChars: 15_000 });
    const said = pageWords({ mode: "all", find: null, cursor: 0, maxChars: 15_000 }, "Tab t1", { text: page.repeat(2) });
    expect(said).toContain('mode "main"');
    expect(said.length).toBeLessThan(15_500);
    expect(parseCall({ name: "read_page", arguments: { mode: "find" } })).toEqual({ arguments: expect.stringContaining("needs `text`") });
    expect(parseCall({ name: "read_page", arguments: { text: "price" } })).toMatchObject({ mode: "find", find: "price" });
  });

  test("items are said as rows, or that there are none", () => {
    const said = pageWords({ mode: "items", find: null, cursor: 0, maxChars: 15_000 }, "Tab t1", {
      items: [{ ref: 4, title: "Bike", price: "$1", details: [] }, { bad: true }],
    });
    expect(said).toBe('Tab t1\n\n1 items:\n1. [4] "Bike" · $1');
    expect(pageWords({ mode: "items", find: null, cursor: 0, maxChars: 1000 }, "T", { items: [] })).toContain('mode "main"');
    expect(plain("x")).toBe("x");
  });
});

test("find cuts a paragraph-long line to the match and its neighbours to their start", () => {
  const long = `${"a ".repeat(400)}the price is $120 ${"b ".repeat(400)}`;
  const found = findInPage(`${"n ".repeat(300)}\n${long}\nend`, "price", 1);
  const [before, match, after] = found.text.split("\n");
  expect(before?.length).toBe(201);
  expect(match).toContain("the price is $120");
  expect(match?.length).toBeLessThan(620);
  expect(after).toBe("end");
});

test("a story's row beats the row of points under it: the title link is the main one", () => {
  const story = (n: number): Spec => ({
    tag: "tr",
    attrs: { class: "athing" },
    children: [
      {
        tag: "td",
        children: [
          `${n}.`,
          { tag: "a", href: `https://example.com/story${n}`, attrs: { href: "x" }, children: [`A rather long story title number ${n}`] },
          " (example.com)",
        ],
      },
    ],
  });
  const sub = (n: number): Spec => ({
    tag: "tr",
    children: [
      {
        tag: "td",
        children: [
          `${n * 10} points by `,
          { tag: "a", href: `https://news.example/user?id=u${n}`, attrs: { href: "x" }, children: [`u${n}`] },
          " 3 hours ago | ",
          { tag: "a", href: "https://news.example/hide", attrs: { href: "x" }, children: ["hide"] },
        ],
      },
    ],
  });
  const rows = [1, 2, 3, 4].flatMap((n) => [story(n), sub(n)]);
  const items = readItems(node({ tag: "body", children: [{ tag: "table", children: rows }] }), numbering());
  expect(items).toHaveLength(4);
  expect(items[0]).toMatchObject({ title: "A rather long story title number 1", href: "https://example.com/story1" });
});
