import { expect, test } from "bun:test";
import { editedLine } from "../src/shared/notes/text.ts";

test("the line over a note says when it was edited and, with a note open, how long it is", () => {
  expect(editedLine("5 November 2026 at 09:12")).toBe("Edited 5 November 2026 at 09:12");
  expect(editedLine("Yesterday", 1)).toBe("Edited Yesterday · 1 word");
  expect(editedLine("Yesterday", 120)).toBe("Edited Yesterday · 120 words");
});
