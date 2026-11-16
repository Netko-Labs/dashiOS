/**
 * edit_note's change to a note's text, pure: replace the one place a text
 * stands, replace a range of lines, or insert before a line. A text that is
 * not there, or there more than once, is refused in words; the result says
 * what was there before, so the change can be put back.
 */

import type { NoteEdit } from "../../tools/index.ts";

export type Edited = { body: string; was: string; where: string } | { error: string };

const count = (haystack: string, needle: string): number => (needle === "" ? 0 : haystack.split(needle).length - 1);

export function editBody(body: string, edit: NoteEdit): Edited {
  if ("find" in edit) {
    const times = count(body, edit.find);
    if (times === 0) return { error: "That text is not in the note: read_note, then give it exactly as it is written." };
    if (times > 1) return { error: `That text is in the note ${times} times: give more of it, so it is there once.` };
    const at = body.indexOf(edit.find);
    const line = body.slice(0, at).split("\n").length;
    return { body: body.replace(edit.find, () => edit.text), was: edit.find, where: `at line ${line}` };
  }
  const lines = body.split("\n");
  if ("at" in edit) {
    if (edit.at < 1 || edit.at > lines.length + 1) return { error: `The note has ${lines.length} lines: \`at_line\` is from 1 to ${lines.length + 1}.` };
    lines.splice(edit.at - 1, 0, ...edit.text.split("\n"));
    return { body: lines.join("\n"), was: "", where: `before line ${edit.at}` };
  }
  if (edit.from < 1 || edit.to < edit.from || edit.to > lines.length) {
    return { error: `The note has ${lines.length} lines: \`from_line\` and \`to_line\` must be within them, in order.` };
  }
  const was = lines.slice(edit.from - 1, edit.to).join("\n");
  lines.splice(edit.from - 1, edit.to - edit.from + 1, ...(edit.text === "" ? [] : edit.text.split("\n")));
  return { body: lines.join("\n"), was, where: `lines ${edit.from} to ${edit.to}` };
}
