import { expect, test } from "bun:test";
import { fitMiddle, nameParts, textWidth, tileName } from "../apps/files/tile-name.ts";

// Names under Files' icons (review 17: "confidential.p" over "df"): broken at a word or a dot, else cut in the middle.
const ROOM = 84 / 12;

test("a name breaks after spaces, hyphens and underscores, or before a dot, never inside a word", () => {
  expect(nameParts("confidential.pdf")).toEqual(["confidential", ".pdf"]);
  expect(nameParts("my report-final_v2.tar.gz")).toEqual(["my ", "report-", "final_", "v2", ".tar", ".gz"]);
  expect(nameParts(".bashrc")).toEqual([".bashrc"]);
  expect(tileName("confidential.pdf", ROOM)).toBe("confidential\n.pdf");
  expect(tileName("a.png", ROOM)).toBe("a.png");
  expect(tileName("Quarterly report.pdf", ROOM)).toBe("Quarterly\nreport.pdf");
});

test("a part too wide for a line, or a name too long for two, loses its middle and keeps its extension", () => {
  const one = tileName("supercalifragilisticexpialidocious.txt", ROOM);
  expect(one).not.toContain("\n");
  expect(one).toContain("…");
  expect(one.endsWith(".txt")).toBe(true);
  expect(textWidth(one)).toBeLessThanOrEqual(ROOM);
  const two = tileName("the minutes of the meeting about the budget for next year.txt", ROOM);
  const lines = two.split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe("the minutes of");
  expect(lines[1]?.endsWith(".txt")).toBe(true);
  expect(lines[1]).toContain("…");
  for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(ROOM);
});

test("fitMiddle keeps a short text whole", () => {
  expect(fitMiddle("notes.md", ROOM)).toBe("notes.md");
});
