/**
 * read_page's text cut to size for a model (decisions.md D203): a part of
 * at most `max` characters from `cursor`, ending at a line, with a cursor for
 * the next; the lines around each match of a text (`find`); a list of items
 * as rows. Pure: the sentences and the cuts are tested.
 */

export interface PagePart {
  text: string;
  /** Where the next part starts, null at the end. */
  next: number | null;
  total: number;
}

/** The part of `text` from `cursor` (a character offset) of at most `max` characters, cut at a line's end where it can be. */
export function partOf(text: string, cursor: number, max: number): PagePart {
  const start = Math.min(Math.max(0, cursor), text.length);
  if (text.length - start <= max) return { text: text.slice(start), next: null, total: text.length };
  const window = text.slice(start, start + max);
  const lineEnd = window.lastIndexOf("\n");
  const end = lineEnd > max / 2 ? start + lineEnd + 1 : start + max;
  return { text: text.slice(start, end), next: end, total: text.length };
}

/** The line after a cut part: how much this is, and how to get the rest. */
export function moreWords(part: PagePart, cursor: number): string {
  if (part.next === null) return cursor > 0 ? `(The end of the page: characters ${cursor.toLocaleString("en")} to ${part.total.toLocaleString("en")}.)` : "";
  return (
    `(This is characters ${cursor.toLocaleString("en")} to ${part.next.toLocaleString("en")} of ${part.total.toLocaleString("en")}. ` +
    `For more: read_page with cursor ${part.next}; mode "main" for the main content only, or mode "find" with text to go straight to a part.)`
  );
}

const fold = (text: string): string => text.toLowerCase().replace(/\s+/g, " ");

/** The lines around each line holding `needle` (case ignored), `around` on each side; runs that touch are joined. */
export function findInPage(text: string, needle: string, around = 3): { text: string; matches: number } {
  const lines = text.split("\n");
  const wanted = fold(needle).trim();
  const hits = lines.flatMap((line, index) => (wanted && fold(line).includes(wanted) ? [index] : []));
  if (hits.length === 0) return { text: "", matches: 0 };
  const runs: Array<[number, number]> = [];
  for (const hit of hits) {
    const from = Math.max(0, hit - around);
    const to = Math.min(lines.length - 1, hit + around);
    const last = runs[runs.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else runs.push([from, to]);
  }
  // A line of a whole paragraph is cut: the match with 300 characters each side, the lines around it to their first 200.
  const shown = (line: string, index: number): string => {
    if (!hits.includes(index)) return line.length > 200 ? `${line.slice(0, 200)}…` : line;
    const at = fold(line).indexOf(wanted);
    const from = Math.max(0, at - 300);
    const to = Math.min(line.length, at + wanted.length + 300);
    return `${from > 0 ? "…" : ""}${line.slice(from, to)}${to < line.length ? "…" : ""}`;
  };
  const joined = runs
    .map(([from, to]) =>
      lines
        .slice(from, to + 1)
        .map((line, offset) => shown(line, from + offset))
        .join("\n"),
    )
    .join("\n…\n");
  return { text: joined, matches: hits.length };
}

export interface ItemRow {
  ref: number | null;
  title: string;
  price?: string;
  href?: string;
  details: string[];
}

/** Items as rows: `1. [12] "Bike, 26 inch" · $120 · Bogotá · 2 days ago → /item/123`. */
export function itemRows(items: readonly ItemRow[]): string {
  return items
    .map((item, index) => {
      const fields = [item.ref !== null ? `[${item.ref}] ${JSON.stringify(item.title)}` : JSON.stringify(item.title), item.price, ...item.details].filter(
        (field): field is string => field !== undefined && field !== "",
      );
      return `${index + 1}. ${fields.join(" · ")}${item.href ? ` → ${item.href}` : ""}`;
    })
    .join("\n");
}

const isRow = (value: unknown): value is ItemRow =>
  typeof value === "object" && value !== null && "title" in value && typeof value.title === "string" && "details" in value && Array.isArray(value.details);

/** read_page's answer for a call: the head line, then the part asked for, and how to get more. */
export function pageWords(
  call: { mode: "all" | "main" | "find" | "items"; find: string | null; cursor: number; maxChars: number },
  head: string,
  result: Record<string, unknown>,
): string {
  if (call.mode === "items") {
    const rows = (Array.isArray(result.items) ? result.items : []).filter(isRow);
    if (rows.length === 0) return `${head}\n\nNo list of repeated items was found on this page: read_page with mode "main" instead.`;
    const part = partOf(itemRows(rows), call.cursor, call.maxChars);
    const more = moreWords(part, call.cursor);
    return `${head}\n\n${rows.length} items:\n${part.text}${more ? `\n${more}` : ""}`;
  }
  const page = String(result.text ?? "");
  const cut = result.truncated === true ? "\n(The page goes on past what Dashi reads at once: scroll_page, then read again, for the rest.)" : "";
  if (call.mode === "find") {
    const found = findInPage(page, call.find ?? "");
    if (found.matches === 0) return `${head}\n\n“${call.find}” is not on the page.`;
    const part = partOf(found.text, call.cursor, call.maxChars);
    const more = moreWords(part, call.cursor);
    return `${head}\n\n${found.matches} line${found.matches === 1 ? "" : "s"} with “${call.find}”:\n${part.text}${more ? `\n${more}` : ""}`;
  }
  const part = partOf(page, call.cursor, call.maxChars);
  const more = moreWords(part, call.cursor);
  return `${head}\n\n${part.text}${more ? `\n${more}` : part.next === null ? cut : ""}`;
}
