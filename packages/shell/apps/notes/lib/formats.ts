/** Format's commands by name (the menu's and the model's), what Undo calls each, and where the caret goes after typing. Pure. */

import { type Edited, insertLink, type Selection, setHeading, toggleChecklist, toggleWrap } from "./format.ts";

export type FormatCommand = "bold" | "italic" | "code" | "strike" | "link" | "checklist" | "heading1" | "heading2" | "heading3" | "body";

/** What Edit › Undo calls a format command's step ("Undo Bold"). */
export const FORMAT_NAMES: Readonly<Record<FormatCommand, string>> = {
  bold: "Bold",
  italic: "Italic",
  code: "Code",
  strike: "Strikethrough",
  link: "Link",
  checklist: "Checklist",
  heading1: "Heading",
  heading2: "Heading",
  heading3: "Heading",
  body: "Body Text",
};

/** `body` with `command` applied where `selection` is. */
export function formatted(body: string, selection: Selection, command: FormatCommand): Edited {
  switch (command) {
    case "bold":
      return toggleWrap(body, selection, "**");
    case "italic":
      return toggleWrap(body, selection, "*");
    case "code":
      return toggleWrap(body, selection, "`");
    case "strike":
      return toggleWrap(body, selection, "~~");
    case "link":
      return insertLink(body, selection);
    case "checklist":
      return toggleChecklist(body, selection);
    case "heading1":
      return setHeading(body, selection, 1);
    case "heading2":
      return setHeading(body, selection, 2);
    case "heading3":
      return setHeading(body, selection, 3);
    case "body":
      return setHeading(body, selection, 0);
  }
}

/**
 * Where the caret is once typing turned `before` into `after`: past what took
 * the selection's place when that is what happened, else past the change.
 * (The field says where its caret is right after; this holds until then.)
 */
export function caretAfter(before: string, after: string, selection: Selection): Selection {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  const typed = after.length - (before.length - (end - start));
  if (typed >= 0 && after.slice(0, start) === before.slice(0, start) && after.slice(start + typed) === before.slice(end)) {
    return { start: start + typed, end: start + typed };
  }
  let tail = 0;
  while (tail < before.length && tail < after.length && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const at = after.length - tail;
  return { start: at, end: at };
}
