import { describe, expect, test } from "bun:test";
import { ALERT_WINDOW, alertButtonsWidth, alertWindowHeight, alertWordsWidth, wrappedLines } from "../src/alert-size.ts";

describe("lines a text wraps to", () => {
  test("a word at a time, a paragraph at least one line", () => {
    expect(wrappedLines("", 100, 10)).toBe(0);
    expect(wrappedLines("Delete it?", 100, 10)).toBe(1);
    // Seven characters a line: "aaa bbb" fits, "ccc" goes under it.
    expect(wrappedLines("aaa bbb ccc", 70, 10)).toBe(2);
    expect(wrappedLines("a\n\nb", 70, 10)).toBe(3);
  });

  test("a word longer than a line breaks across lines", () => {
    expect(wrappedLines("x".repeat(20), 70, 10)).toBe(3);
    expect(wrappedLines(`ab ${"x".repeat(14)} cd`, 70, 10)).toBe(4);
  });
});

describe("an alert window's height", () => {
  const { strip, top, padding, tile, bodyGap, buttonsTop, button } = ALERT_WINDOW;
  const frame = strip + top + bodyGap + buttonsTop + button + padding;

  test("a short question and message: the tile's height, the buttons, nothing to spare", () => {
    expect(alertWordsWidth(420)).toBe(330);
    expect(alertWindowHeight({ question: "Delete it?", message: "You can’t undo this." }, 420)).toBe(frame + tile);
    expect(frame + tile).toBe(146);
    // An ordinary title bar: the padding above instead of the controls' strip.
    expect(alertWindowHeight({ question: "Saved." }, 420, false)).toBe(padding + tile + bodyGap + buttonsTop + button + padding);
  });

  test("words taller than the tile set the height; what the answer needs goes under them", () => {
    const long = "word ".repeat(80).trim();
    const tall = alertWindowHeight({ question: "Delete it?", message: long }, 420);
    expect(tall).toBe(frame + 17 + 4 + wrappedLines(long, 330, ALERT_WINDOW.message.char) * 16);
    expect(alertWindowHeight({ question: "Share?", message: "“To sign you in”", extra: 64 }, 420)).toBe(frame + 17 + 4 + 16 + 4 + 6 + 64);
  });
});

describe("a row of buttons", () => {
  test("each is at least 84 wide, else its label and 14 either side; 8 between", () => {
    expect(alertButtonsWidth(["OK"])).toBe(84);
    expect(alertButtonsWidth(["Cancel", "OK"])).toBe(84 + 8 + 84);
    // Calendar's repeat question: four buttons, wider than a 460 sheet holds.
    const four = alertButtonsWidth(["Cancel", "This event", "This and following", "All events"]);
    expect(four).toBeGreaterThan(460 - 40);
  });
});
