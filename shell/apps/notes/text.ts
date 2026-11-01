/**
 * A note's text: its file is Markdown, its title the first line (a leading
 * "# " is the Markdown way to write it and is what the app writes; a file
 * from elsewhere whose first line is plain stays plain), the rest the body.
 * Also what the list shows (a preview, a date), the footer's word count, and
 * search.
 */

export interface NoteText {
  title: string;
  body: string;
  /** The first line carries a "# " marker. */
  heading: boolean;
}

/** A file's text as a title and a body: the first line is the title, whatever it is. */
export function parseNote(text: string): NoteText {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const line = lines[0] ?? "";
  const marked = /^#{1,6}[ \t]+/.exec(line);
  const title = (marked ? line.slice(marked[0].length) : line).trim();
  const rest = lines.slice(1);
  // One blank line after the title belongs to the format, not the body.
  if (title !== "" && rest.length > 0 && (rest[0] ?? "").trim() === "") rest.shift();
  // The file's last newline ends its last line; it is not part of the body.
  if (rest.length > 0 && rest[rest.length - 1] === "") rest.pop();
  return { title, body: rest.join("\n"), heading: marked !== null };
}

/** The file's text for a title and a body; an empty note is an empty file. A body with no title starts on the second line. */
export function serializeNote(note: NoteText): string {
  const title = note.title.replace(/\s*\n\s*/g, " ").trim();
  // Blank lines at the end go; spaces after the last word stay (a checklist item just added is "- [ ] ", waiting for its text).
  const body = note.body.replace(/(?:\n[ \t]*)+$/, "").replace(/^[ \t]*$/, "");
  if (title === "") return body === "" ? "" : `\n${body}\n`;
  const head = note.heading ? `# ${title}` : title;
  return body === "" ? `${head}\n` : `${head}\n\n${body}\n`;
}

/** The list's second line: the body's first line with something in it, markers and all trimmed off. */
export function preview(body: string): string {
  for (const line of body.split("\n")) {
    const text = line
      .replace(/^\s*(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|>\s*|#{1,6}\s+|\d+\.\s+)/, "")
      .trim();
    if (text !== "" && !/^(?:[-*_]\s*){3,}$/.test(text) && !text.startsWith("```")) return text.length > 160 ? text.slice(0, 160) : text;
  }
  return "";
}

/** Words in the title and body, as the footer counts them. */
export function wordCount(text: string): number {
  // A checklist's box is not a word.
  return text.replace(/^\s*[-*+]\s+\[[ xX]\]/gm, "").match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
}

export interface Searchable {
  title: string;
  body: string;
  modified: number;
  pinned: boolean;
}

/**
 * Notes whose title or body holds every word of `query` (case and accents
 * ignored), the ones with a word in the title first, then by modified time.
 * A blank query matches everything, in list order.
 */
export function searchNotes<T extends Searchable>(notes: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return listOrder(notes);
  const scored: Array<{ note: T; inTitle: boolean }> = [];
  for (const note of notes) {
    const title = fold(note.title);
    const all = `${title}\n${fold(note.body)}`;
    if (words.every((word) => all.includes(word))) scored.push({ note, inTitle: words.some((word) => title.includes(word)) });
  }
  return scored
    .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.note.modified - a.note.modified)
    .map((entry) => entry.note);
}

/** Pinned first, then the most recently modified. */
export function listOrder<T extends Searchable>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.modified - a.modified);
}

/** Lowercase, without accents. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

const DAY = 86_400_000;

/**
 * The list's date: the time today, "Yesterday", the weekday this week, then
 * the date. `now` and `locale` are given so it can be tested.
 */
export function listDate(time: number, now: number = Date.now(), locale?: string): string {
  const at = new Date(time);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - new Date(at).setHours(0, 0, 0, 0)) / DAY);
  if (days <= 0) return at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return at.toLocaleDateString(locale, { weekday: "long" });
  return at.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

/** "12 notes". */
export const noteCount = (count: number): string => `${count} ${count === 1 ? "note" : "notes"}`;

/** Days left before a deleted note goes for good. */
export function daysLeft(deletedAt: number, now: number, keepDays: number): number {
  return Math.min(keepDays, Math.max(0, Math.ceil((deletedAt + keepDays * DAY - now) / DAY)));
}
