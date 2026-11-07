import { describe, expect, test } from "bun:test";
import { continueList, insertLink, setHeading, toggleCheck, toggleChecklist, toggleWrap } from "../apps/notes/format.ts";
import { caretAfter, formatted } from "../apps/notes/formats.ts";

const at = (start: number, end = start) => ({ start, end });

describe("Bold, Italic, Code: wrapping toggles", () => {
  test("the selection is wrapped and stays on its words", () => {
    expect(toggleWrap("a big b", at(2, 5), "**")).toEqual({ body: "a **big** b", selection: at(4, 7) });
  });

  test("wrapped again, it is unwrapped (markers around it, or at its ends)", () => {
    expect(toggleWrap("a **big** b", at(4, 7), "**")).toEqual({ body: "a big b", selection: at(2, 5) });
    expect(toggleWrap("a **big** b", at(2, 9), "**")).toEqual({ body: "a big b", selection: at(2, 5) });
  });

  test("with nothing selected, the word under the caret; between words, a pair to type in", () => {
    expect(toggleWrap("a big b", at(3), "*").body).toBe("a *big* b");
    expect(toggleWrap("a  b", at(2), "`")).toEqual({ body: "a `` b", selection: at(3) });
  });

  test("italic leaves bold's stars alone", () => {
    expect(toggleWrap("**big**", at(2, 5), "*").body).toBe("***big***");
  });

  test("Link puts the caret where the address goes; a selected address becomes the address", () => {
    expect(insertLink("see plan", at(4, 8))).toEqual({ body: "see [plan]()", selection: at(11) });
    expect(insertLink("https://a.b", at(0, 11))).toEqual({ body: "[](https://a.b)", selection: at(1) });
  });

  test("formatted runs the command by name", () => {
    expect(formatted("x", at(0, 1), "strike").body).toBe("~~x~~");
    expect(formatted("x", at(0, 1), "heading2").body).toBe("## x");
  });
});

describe("Checklist and headings act on whole lines", () => {
  test("a line becomes an item where the caret is, not at the end of the note", () => {
    expect(toggleChecklist("milk\neggs", at(1))).toEqual({ body: "- [ ] milk\neggs", selection: at(7) });
  });

  test("a bullet keeps its text; all items become plain lines again", () => {
    expect(toggleChecklist("- milk\n- eggs", at(0, 13)).body).toBe("- [ ] milk\n- [ ] eggs");
    expect(toggleChecklist("- [ ] milk\n- [x] eggs", at(0, 21)).body).toBe("milk\neggs");
  });

  test("heading levels toggle, and Body Text clears them", () => {
    expect(setHeading("Plan", at(2), 1)).toEqual({ body: "# Plan", selection: at(4) });
    expect(setHeading("# Plan", at(4), 1).body).toBe("Plan");
    expect(setHeading("# Plan", at(4), 3).body).toBe("### Plan");
    expect(setHeading("## Plan", at(5), 0).body).toBe("Plan");
  });

  test("a box ticks and unticks; another line is left alone", () => {
    expect(toggleCheck("- [ ] a\n- [x] b", 0)).toBe("- [x] a\n- [x] b");
    expect(toggleCheck("- [ ] a\n- [X] b", 1)).toBe("- [ ] a\n- [ ] b");
    expect(toggleCheck("plain", 0)).toBe("plain");
  });
});

describe("Enter in a list", () => {
  test("the next item starts with the same marker, an unticked box, or the next number", () => {
    expect(continueList("- [x] milk", "- [x] milk\n", 10)).toEqual({ body: "- [x] milk\n- [ ] ", selection: at(17) });
    expect(continueList("* a", "* a\n", 3)).toEqual({ body: "* a\n* ", selection: at(6) });
    expect(continueList("9. a", "9. a\n", 4)?.body).toBe("9. a\n10. ");
  });

  test("in the middle of a list, where the caret was", () => {
    expect(continueList("- a\n- b", "- a\n\n- b", 3)).toEqual({ body: "- a\n- \n- b", selection: at(6) });
  });

  test("an empty item ends the list; Enter elsewhere is just Enter", () => {
    expect(continueList("- a\n- ", "- a\n- \n", 6)).toEqual({ body: "- a\n", selection: at(4) });
    expect(continueList("- a b", "- a\n b", 3)).toBeNull();
    expect(continueList("text", "text\n", 4)).toBeNull();
    // On the empty line after a list (the same text as Enter after its item): the caret says which.
    expect(continueList("- a\n", "- a\n\n", 4)).toBeNull();
  });
});

describe("where the caret goes after typing", () => {
  test("past what replaced the selection", () => {
    expect(caretAfter("abc", "aXc", at(1, 2))).toEqual(at(2));
    expect(caretAfter("abc", "abXYc", at(2))).toEqual(at(4));
    expect(caretAfter("abc", "ac", at(2))).toEqual(at(1));
  });
});
