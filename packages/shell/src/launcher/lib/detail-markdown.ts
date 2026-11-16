/**
 * The small Markdown a launcher detail draws (a pull request's or an issue's
 * body, GitHub's flavour): headings (`#` and underlined), paragraphs, list
 * items, code blocks, tables (read as Notes reads them), rules (`---`), and
 * quotes, GitHub's alerts (`> [!NOTE]`) among them. Pure: detail-view.tsx
 * draws the blocks.
 */

import { continuesTable, parseTable, startsTable, type Table } from "../../shared/markdown/index.ts";

/** GitHub's five alerts, by the word in `[!…]`. */
export type Alert = "note" | "tip" | "important" | "warning" | "caution";
const ALERTS: readonly Alert[] = ["note", "tip", "important", "warning", "caution"];

export type MarkdownBlock =
  | { kind: "h1" | "h2" | "p" | "li" | "code"; text: string }
  | { kind: "table"; table: Table }
  | { kind: "rule" }
  /** A quote's paragraphs, one a line; an alert's own word is not among them. */
  | { kind: "quote"; text: string; alert?: Alert };

/** A detail draws at most this many blocks: a body longer than that is cut, as GitHub's own preview cuts. */
const MOST = 120;

/** A cell's or a line's words: inline marks dropped, links show their words. */
export const inline = (text: string): string =>
  text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/<[^>]+>/g, "");

/** `---`, `***` or `___` (spaces between allowed), alone on its line. */
const isRule = (trimmed: string): boolean => /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(trimmed);

/** The quote whose `>` lines are `lines`: an alert's word on its first line, its paragraphs one a line. */
export function quoteOf(lines: readonly string[]): MarkdownBlock {
  const bare = lines.map((line) => line.trim().replace(/^>\s?/, ""));
  const word = /^\[!(\w+)\]\s*$/.exec(bare[0]?.trim() ?? "")?.[1]?.toLowerCase();
  const alert = ALERTS.find((each) => each === word);
  const paragraphs: string[] = [];
  let open = false;
  for (const line of alert ? bare.slice(1) : bare) {
    const text = inline(line.trim());
    if (text === "") open = false;
    else if (open) paragraphs[paragraphs.length - 1] += ` ${text}`;
    else {
      paragraphs.push(text);
      open = true;
    }
  }
  return { kind: "quote", text: paragraphs.join("\n"), ...(alert ? { alert } : {}) };
}

/** The line's own block, for a line that is no table, code fence or quote. */
function lineBlock(trimmed: string): MarkdownBlock {
  const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
  if (heading) return { kind: (heading[1] ?? "#").length === 1 ? "h1" : "h2", text: inline(heading[2] ?? "") };
  if (/^[-*+]\s+/.test(trimmed)) return { kind: "li", text: inline(trimmed.replace(/^[-*+]\s+/, "")) };
  return { kind: "p", text: inline(trimmed) };
}

export function markdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split("\n");
  let code: string[] | null = null;
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (code) blocks.push({ kind: "code", text: code.join("\n") });
      code = code ? null : [];
    } else if (code) code.push(line);
    else if (startsTable(lines, at)) {
      let end = at + 2;
      while (end < lines.length && continuesTable(lines[end] ?? "")) end++;
      blocks.push({ kind: "table", table: parseTable(lines.slice(at, end)) });
      at = end - 1;
    } else if (trimmed.startsWith(">")) {
      let end = at + 1;
      while (end < lines.length && (lines[end] ?? "").trim().startsWith(">")) end++;
      blocks.push(quoteOf(lines.slice(at, end)));
      at = end - 1;
    } else if (/^(=+|-+)$/.test(trimmed) && blocks.at(-1)?.kind === "p" && (lines[at - 1] ?? "").trim() !== "") {
      // Underlined: the paragraph above is a heading (`===` the first level, `---` the second).
      const above = blocks.pop();
      blocks.push({ kind: trimmed.startsWith("=") ? "h1" : "h2", text: above && "text" in above ? above.text : "" });
    } else if (isRule(trimmed)) blocks.push({ kind: "rule" });
    else if (trimmed !== "") blocks.push(lineBlock(trimmed));
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks.slice(0, MOST);
}
