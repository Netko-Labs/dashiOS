import { describe, expect, test } from "bun:test";
import { rangeOf, type Selection } from "../apps/preview/document.ts";
import { parseBboxLayout, selectedOnPage, selectedText, selectionBoxes, turnBox, unturnPoint, type Word, wordAt } from "../apps/preview/text.ts";

// Selecting a PDF's text: poppler's words and boxes (text.ts), and a drag's range (document.ts).

const PAGE = `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><doc>
  <page width="600.000000" height="800.000000">
    <flow>
      <block xMin="100" yMin="50" xMax="400" yMax="70">
        <line xMin="100" yMin="50" xMax="400" yMax="70">
          <word xMin="100.000000" yMin="50.000000" xMax="160.000000" yMax="70.000000">Dear</word>
          <word xMin="170.000000" yMin="50.000000" xMax="230.000000" yMax="70.000000">Alex,</word>
        </line>
        <line xMin="100" yMin="80" xMax="400" yMax="100">
          <word xMin="100.000000" yMin="80.000000" xMax="200.000000" yMax="100.000000">rent&amp;fees</word>
          <word xMin="210.000000" yMin="80.000000" xMax="260.000000" yMax="100.000000">&#233;t&#xe9;</word>
        </line>
      </block>
      <block xMin="100" yMin="200" xMax="400" yMax="220">
        <line xMin="100" yMin="200" xMax="400" yMax="220">
          <word xMin="100.000000" yMin="200.000000" xMax="150.000000" yMax="220.000000">Thanks</word>
        </line>
      </block>
    </flow>
  </page>
</doc></body></html>`;

const parsed = parseBboxLayout(PAGE);
const words = parsed?.words ?? [];

describe("a page's words", () => {
  test("read in order with their boxes, lines and blocks; entities decoded", () => {
    expect(parsed?.width).toBe(600);
    expect(words.map((word) => word.text)).toEqual(["Dear", "Alex,", "rent&fees", "été", "Thanks"]);
    expect(words.map((word) => [word.line, word.block])).toEqual([
      [0, 0],
      [0, 0],
      [1, 0],
      [1, 0],
      [2, 1],
    ]);
    expect(words[0]).toMatchObject({ x0: 100, y0: 50, x1: 160, y1: 70 });
    expect(parseBboxLayout("<html></html>")).toBeNull();
    expect(parseBboxLayout('<page width="0" height="10"></page>')).toBeNull();
  });

  test("the word at a point: under it, else the nearest on its line, else the nearest", () => {
    expect(wordAt(words, 120, 60)).toBe(0);
    expect(wordAt(words, 500, 60)).toBe(1);
    expect(wordAt(words, 0, 90)).toBe(2);
    expect(wordAt(words, 120, 190)).toBe(4);
    expect(wordAt([], 1, 1)).toBeNull();
  });

  test("the selection's text: spaces on a line, a break between lines, a blank line between paragraphs and pages", () => {
    const pages = new Map<number, readonly Word[]>([
      [1, words],
      [2, words],
    ]);
    expect(selectedText({ anchor: { page: 1, index: 1 }, focus: { page: 1, index: 3 } }, pages)).toBe("Alex,\nrent&fees été");
    expect(selectedText({ anchor: { page: 1, index: 4 }, focus: { page: 1, index: 2 } }, pages)).toBe("rent&fees été\n\nThanks");
    expect(selectedText({ anchor: { page: 1, index: 4 }, focus: { page: 2, index: 0 } }, pages)).toBe("Thanks\n\nDear");
  });

  test("a page's part of a selection, and one box per line to draw", () => {
    const range = { anchor: { page: 2, index: 3 }, focus: { page: 4, index: 1 } };
    expect(selectedOnPage(range, 1, 5)).toBeNull();
    expect(selectedOnPage(range, 2, 5)).toEqual([3, 4]);
    expect(selectedOnPage(range, 3, 5)).toEqual([0, 4]);
    expect(selectedOnPage(range, 4, 5)).toEqual([0, 1]);
    expect(selectedOnPage(range, 3, 0)).toBeNull();
    expect(selectionBoxes(words, [1, 3])).toEqual([
      { x0: 170, y0: 50, x1: 230, y1: 70 },
      { x0: 100, y0: 80, x1: 260, y1: 100 },
    ]);
  });
});

describe("rotated pages", () => {
  const size = { width: 600, height: 800 };
  const box = { x0: 100, y0: 50, x1: 160, y1: 70 };

  test("a box turns with the page, and a point on the turned page comes back to where it was", () => {
    expect(turnBox(box, size, 0)).toEqual(box);
    expect(turnBox(box, size, 1)).toEqual({ x0: 730, y0: 100, x1: 750, y1: 160 });
    expect(turnBox(box, size, 2)).toEqual({ x0: 440, y0: 730, x1: 500, y1: 750 });
    expect(turnBox(box, size, 3)).toEqual({ x0: 50, y0: 440, x1: 70, y1: 500 });
    for (const turns of [0, 1, 2, 3]) {
      const turned = turnBox({ x0: 130, y0: 60, x1: 130, y1: 60 }, size, turns);
      expect(unturnPoint(turned.x0, turned.y0, size, turns)).toEqual({ x: 130, y: 60 });
    }
  });
});

describe("a drag's selection", () => {
  test("covers words once both ends' pages are read", () => {
    const selection: Selection = { anchor: { page: 1, x: 120, y: 60 }, focus: { page: 1, x: 220, y: 90 } };
    expect(rangeOf(selection, new Map())).toBeNull();
    const texts = new Map([[1, { width: 600, height: 800, words }]]);
    expect(rangeOf(selection, texts)).toEqual({ anchor: { page: 1, index: 0 }, focus: { page: 1, index: 3 } });
  });
});
