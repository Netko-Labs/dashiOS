import { expect, test } from "bun:test";
import { fitMiddle, keepExtension, nameParts, textWidth, tileName } from "../src/shared/file-browser/tile-name.ts";

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

test("a part too wide for a line breaks between letters and fills the second line before it loses its middle", () => {
  // Review 54 (07): "AVery…nal.md" sat on one line while the second was empty.
  const one = tileName("supercalifragilisticexpialidocious.txt", ROOM);
  const [first, second] = one.split("\n");
  expect(one.split("\n")).toHaveLength(2);
  expect("supercalifragilisticexpialidocious.txt".startsWith(first ?? "")).toBe(true);
  expect(second).toContain("…");
  expect(second?.endsWith(".txt")).toBe(true);
  for (const line of one.split("\n")) expect(textWidth(line)).toBeLessThanOrEqual(ROOM);
  const long = tileName("AVeryLongFileNameWithoutAnySpacesAtAllThatCannotWrapNormal.md", ROOM);
  expect(long.split("\n")[0]?.startsWith("AVery")).toBe(true);
  expect(long.endsWith(".md")).toBe(true);
  // A short unbreakable tail fits whole on the second line, with no ellipsis.
  expect(tileName("abcdefghijklmnopqrstu.md", ROOM)).not.toContain("…");
  expect(tileName("abcdefghijklmnopqrstu.md", ROOM).replace("\n", "")).toBe("abcdefghijklmnopqrstu.md");
});

test("a name too long for two lines loses the middle of its second and keeps its extension", () => {
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

test("the extension stays on its last word when the name breaks somewhere else", () => {
  // Review 54 (the editor's Open chooser): "meeting-notes" over a lone ".txt".
  expect(keepExtension(nameParts("meeting-notes.txt"))).toEqual(["meeting-", "notes.txt"]);
  expect(keepExtension(nameParts("my report-final_v2.tar.gz"))).toEqual(["my ", "report-", "final_", "v2", ".tar.gz"]);
  expect(keepExtension(nameParts("confidential.pdf"))).toEqual(["confidential", ".pdf"]);
  expect(keepExtension(nameParts("archive.tar.gz"))).toEqual(["archive", ".tar", ".gz"]);
  for (const name of ["meeting-notes.txt", "legacy-menu.txt", "long-checklist.txt", "versions-demo.txt"]) {
    const shown = tileName(name, ROOM);
    expect(shown.split("\n").every((line) => !line.startsWith("."))).toBe(true);
    expect(shown.replace("\n", "")).toBe(name);
  }
  expect(tileName("meeting-notes.txt", ROOM)).toBe("meeting-\nnotes.txt");
});
