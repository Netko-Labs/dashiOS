/**
 * The light formatting Notes draws in its preview: headings, quotes,
 * bullets, numbered items, code fences, rules, and checklists (`- [ ]` and
 * `- [x]` lines, whose box can be tapped). Markdown stays the file format;
 * this reads it line by line and never changes anything but the box.
 */

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "check"; checked: boolean; text: string; line: number }
  | { kind: "bullet"; text: string; indent: number }
  | { kind: "number"; label: string; text: string; indent: number }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "text"; text: string }
  | { kind: "blank" };

const CHECK = /^(\s*)[-*+]\s+\[([ xX])\]\s?(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBER = /^(\s*)(\d{1,9}[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

/** The body as blocks, one per line (a code fence's lines are `code` blocks; the fences themselves are dropped). */
export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let fenced = false;
  body.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return void blocks.push({ kind: "code", text: line });
    const check = CHECK.exec(line);
    if (check) return void blocks.push({ kind: "check", checked: check[2] !== " ", text: check[3] ?? "", line: index });
    if (RULE.test(line)) return void blocks.push({ kind: "rule" });
    const heading = HEADING.exec(line);
    if (heading) return void blocks.push({ kind: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
    const bullet = BULLET.exec(line);
    if (bullet) return void blocks.push({ kind: "bullet", text: bullet[2] ?? "", indent: Math.floor((bullet[1]?.length ?? 0) / 2) });
    const number = NUMBER.exec(line);
    if (number) return void blocks.push({ kind: "number", label: number[2] ?? "", text: number[3] ?? "", indent: Math.floor((number[1]?.length ?? 0) / 2) });
    if (line.startsWith(">")) return void blocks.push({ kind: "quote", text: line.replace(/^>\s?/, "") });
    blocks.push(line.trim() === "" ? { kind: "blank" } : { kind: "text", text: line });
  });
  return blocks;
}

/** The body with the checklist item on `line` ticked or unticked; unchanged if that line isn't one. */
export function toggleCheck(body: string, line: number): string {
  const lines = body.split("\n");
  const current = lines[line];
  if (current === undefined) return body;
  const match = CHECK.exec(current);
  if (!match) return body;
  lines[line] = current.replace(/\[([ xX])\]/, match[2] === " " ? "[x]" : "[ ]");
  return lines.join("\n");
}

/** Whether `body` has a checklist item. */
export const hasChecklist = (body: string): boolean => body.split("\n").some((line) => CHECK.test(line));

/**
 * What typing Enter at the end of a list item should leave behind: when `next`
 * is `previous` plus one newline and the last line of `previous` is a bullet
 * or checklist item with text, the same marker on the new line (an empty item
 * ends the list instead, as in every Markdown editor). Otherwise null.
 */
export function continueList(previous: string, next: string): string | null {
  if (next !== `${previous}\n`) return null;
  const last = previous.slice(previous.lastIndexOf("\n") + 1);
  const check = /^(\s*[-*+])\s+\[[ xX]\]\s?(.*)$/.exec(last);
  if (check) return check[2]?.trim() === "" ? `${previous.slice(0, previous.length - last.length)}\n` : `${next}${check[1]} [ ] `;
  const bullet = /^(\s*[-*+])\s+(.*)$/.exec(last);
  if (bullet) return bullet[2]?.trim() === "" ? `${previous.slice(0, previous.length - last.length)}\n` : `${next}${bullet[1]} `;
  return null;
}
