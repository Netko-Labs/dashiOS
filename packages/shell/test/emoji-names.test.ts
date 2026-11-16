// Pass 37: the Emoji extension named the red ❤ "black heart…", Unicode's old character name. The names are
// the current ones (CLDR short names, Emoji 17.0) now.

import { expect, test } from "bun:test";
import { allEmoji, findEmoji } from "../extensions/emoji/lib/search.ts";

const all = allEmoji();
const nameOf = (char: string): string | undefined => all.find((each) => each.char.replace("️", "") === char.replace("️", ""))?.name;

test("emoji carry today's names, not the old character names", () => {
  expect(nameOf("❤️")).toBe("red heart");
  expect(nameOf("😃")).toBe("grinning face with big eyes");
  expect(nameOf("👍")).toBe("thumbs up");
  expect(nameOf("☀️")).toBe("sun");
  expect(nameOf("🖤")).toBe("black heart");
  // Nothing is left with an old-style name that today's list renamed.
  for (const old of ["heavy black heart", "thumbs up sign", "smiling face with open mouth", "black sun with rays"])
    expect(all.some((each) => each.name === old)).toBe(false);
});

test("a search finds them by today's words", () => {
  expect(findEmoji(all, "red heart").map((each) => each.char)).toContain("❤️");
  expect(findEmoji(all, "thumb up").map((each) => each.name)).toEqual(["thumbs up"]);
  // Every emoji still has a name.
  expect(all.every((each) => each.name.length > 0 && each.char.length > 0)).toBe(true);
});
