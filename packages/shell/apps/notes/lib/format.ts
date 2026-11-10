/**
 * Format › Bold, Italic, Code, Strikethrough, Link, the headings and
 * Checklist, as edits of a note's Markdown: each takes the body and the
 * selection (offsets into it) and gives back both, so the caret stays with
 * what it was on. Wrapping toggles: bolding bold text unbolds it. Pure.
 */

export interface Selection {
  start: number;
  end: number;
}

export interface Edited {
  body: string;
  selection: Selection;
}

const ordered = (selection: Selection): Selection => (selection.start <= selection.end ? selection : { start: selection.end, end: selection.start });

/**
 * Wraps the selection in `marker` (`**`, `*`, `` ` ``, `~~`), or unwraps it
 * when the markers are already around it or at its ends. With nothing
 * selected, the word the caret is in is wrapped; between words, an empty
 * pair goes in with the caret inside, for typing.
 */
export function toggleWrap(body: string, selection: Selection, marker: string): Edited {
  let { start, end } = ordered(selection);
  const size = marker.length;
  if (start === end) {
    const word = wordAt(body, start);
    if (word) ({ start, end } = word);
  }
  // Markers just outside the selection: take them away.
  if (
    start >= size &&
    body.slice(start - size, start) === marker &&
    body.slice(end, end + size) === marker &&
    !doubled(body, start - size, end + size, marker)
  ) {
    return { body: body.slice(0, start - size) + body.slice(start, end) + body.slice(end + size), selection: shift(selection, -size, start, end) };
  }
  // The selection holds them at its ends.
  const inner = body.slice(start, end);
  if (inner.length >= size * 2 && inner.startsWith(marker) && inner.endsWith(marker) && !doubled(body, start, end, marker)) {
    const bare = inner.slice(size, inner.length - size);
    return { body: body.slice(0, start) + bare + body.slice(end), selection: { start, end: start + bare.length } };
  }
  if (start === end) return { body: body.slice(0, start) + marker + marker + body.slice(end), selection: { start: start + size, end: start + size } };
  return { body: body.slice(0, start) + marker + inner + marker + body.slice(end), selection: shift(selection, size, start, end) };
}

/** `*` around a span is italic unless it is one star of `**` (bold): that is not italic's to remove. */
function doubled(body: string, outerStart: number, outerEnd: number, marker: string): boolean {
  if (marker.length !== 1) return false;
  return body[outerStart - 1] === marker || body[outerEnd] === marker;
}

/** The selection moved by `by` where it sat inside `start..end` (the wrapped text moved with its markers). */
function shift(selection: Selection, by: number, start: number, end: number): Selection {
  const move = (at: number): number => (at < start ? at : at > end ? at + 2 * by : at + by);
  return { start: move(selection.start), end: move(selection.end) };
}

/** The word around `at` (letters, digits, apostrophes), or null between words. */
export function wordAt(body: string, at: number): Selection | null {
  const isWord = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}'’_]/u.test(char);
  let start = at;
  let end = at;
  while (start > 0 && isWord(body[start - 1])) start--;
  while (end < body.length && isWord(body[end])) end++;
  return start === end ? null : { start, end };
}

/** Puts `[selected](|)` in place of the selection, the caret where the address goes. */
export function insertLink(body: string, selection: Selection): Edited {
  const { start, end } = ordered(selection);
  const words = body.slice(start, end);
  if (/^https?:\/\/\S+$/.test(words)) {
    const text = `[](${words})`;
    return { body: body.slice(0, start) + text + body.slice(end), selection: { start: start + 1, end: start + 1 } };
  }
  const text = `[${words}]()`;
  const at = start + words.length + 3;
  return { body: body.slice(0, start) + text + body.slice(end), selection: { start: at, end: at } };
}

/** The lines the selection touches: where the first starts and the last ends. */
function lineSpan(body: string, selection: Selection): { from: number; to: number } {
  const { start, end } = ordered(selection);
  const from = body.lastIndexOf("\n", start - 1) + 1;
  const after = body.indexOf("\n", end);
  return { from, to: after < 0 ? body.length : after };
}

/** Each line the selection touches rewritten by `change`; the selection keeps its place in the text. */
function eachLine(body: string, selection: Selection, change: (line: string, lines: readonly string[]) => string): Edited {
  const { from, to } = lineSpan(body, selection);
  const lines = body.slice(from, to).split("\n");
  const changed = lines.map((line) => change(line, lines));
  const out = body.slice(0, from) + changed.join("\n") + body.slice(to);
  // Where an offset was, it moves by what changed in front of it on its line (and the lines before it).
  const move = (at: number): number => {
    let old = from;
    let now = from;
    for (const [index, line] of lines.entries()) {
      const next = changed[index] ?? line;
      if (at <= old + line.length) return Math.max(now, now + (at - old) + (next.length - line.length));
      old += line.length + 1;
      now += next.length + 1;
    }
    return at + (out.length - body.length);
  };
  return { body: out, selection: { start: move(selection.start), end: move(selection.end) } };
}

const CHECK_PREFIX = /^([ \t]*)[-*+][ \t]+\[[ xX]\][ \t]?/;
const BULLET_PREFIX = /^([ \t]*)[-*+][ \t]+/;
const NUMBER_PREFIX = /^([ \t]*)\d{1,9}[.)][ \t]+/;
const HEADING_PREFIX = /^#{1,6}[ \t]+/;

/** Checklist: the lines become items (a bullet keeps its text), or stop being items when they all are. */
export function toggleChecklist(body: string, selection: Selection): Edited {
  return eachLine(body, selection, (line, lines) => {
    const allItems = lines.every((each) => each.trim() === "" || CHECK_PREFIX.test(each));
    if (allItems) return line.replace(CHECK_PREFIX, "$1");
    if (CHECK_PREFIX.test(line) || (line.trim() === "" && lines.length > 1)) return line;
    const bare = line.replace(HEADING_PREFIX, "");
    const bullet = BULLET_PREFIX.exec(bare) ?? NUMBER_PREFIX.exec(bare);
    if (bullet) return `${bullet[1] ?? ""}- [ ] ${bare.slice(bullet[0].length)}`;
    const indent = /^[ \t]*/.exec(bare)?.[0] ?? "";
    return `${indent}- [ ] ${bare.slice(indent.length)}`;
  });
}

/** Heading 1 to 3 (0: body text): the lines take that heading, or lose it when they already have it. */
export function setHeading(body: string, selection: Selection, level: number): Edited {
  const marker = level > 0 ? `${"#".repeat(level)} ` : "";
  return eachLine(body, selection, (line, lines) => {
    const same = level > 0 && lines.every((each) => each.trim() === "" || each.startsWith(marker));
    const bare = line.replace(HEADING_PREFIX, "");
    if (same || level === 0) return bare;
    return line.trim() === "" && lines.length > 1 ? line : marker + bare;
  });
}

/** Ticks or unticks the checklist item on line `line` (0-based); the body unchanged if it isn't one. */
export function toggleCheck(body: string, line: number): string {
  const lines = body.split("\n");
  const current = lines[line];
  if (current === undefined) return body;
  const match = /^([ \t]*[-*+][ \t]+\[)([ xX])(\])/.exec(current);
  if (!match) return body;
  lines[line] = `${match[1]}${match[2] === " " ? "x" : " "}${match[3]}${current.slice(match[0].length)}`;
  return lines.join("\n");
}

/**
 * Enter at the end of a list item (`before` became `after` by a newline
 * typed at `at`, where the caret was): the next line starts with the same
 * marker, an unticked box for a checklist, the next number for a numbered
 * list. Enter on an item with nothing in it ends the list instead, as every
 * Markdown editor does. Null when it was no such Enter.
 */
export function continueList(before: string, after: string, at: number): Edited | null {
  const caret = at + 1;
  if (at < 0 || at > before.length || after !== `${before.slice(0, at)}\n${before.slice(at)}`) return null;
  const lineStart = before.lastIndexOf("\n", at - 1) + 1;
  const line = before.slice(lineStart, at);
  const rest = before.slice(at, before.indexOf("\n", at) < 0 ? before.length : before.indexOf("\n", at));
  if (rest.trim() !== "") return null;
  const check = /^([ \t]*[-*+])[ \t]+\[[ xX]\][ \t]?(.*)$/.exec(line);
  const bullet = /^([ \t]*[-*+])[ \t]+(.*)$/.exec(line);
  const number = /^([ \t]*)(\d{1,9})([.)])[ \t]+(.*)$/.exec(line);
  const words = check?.[2] ?? number?.[4] ?? bullet?.[2];
  if (words === undefined) return null;
  if (words.trim() === "") {
    // An empty item ends the list: its marker goes, and so does the new line.
    const body = before.slice(0, lineStart) + before.slice(at);
    return { body, selection: { start: lineStart, end: lineStart } };
  }
  const marker = check ? `${check[1]} [ ] ` : number ? `${number[1]}${Number(number[2]) + 1}${number[3]} ` : `${bullet?.[1] ?? "-"} `;
  const body = after.slice(0, caret) + marker + after.slice(caret);
  const end = caret + marker.length;
  return { body, selection: { start: end, end } };
}
