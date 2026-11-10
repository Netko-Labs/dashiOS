/**
 * What a note's Markdown looks like as it is typed: the spans of its body
 * (offsets into it) that the live page draws differently, the text itself
 * unchanged. Headings are sized, `**bold**` is bold, `*italic*` italic,
 * `` `code` `` and fenced lines sit on a wash, `~~struck~~` is struck, a link's
 * words are underlined, a checklist item's box can be pressed and a ticked
 * item's words are struck, and every marker (`#`, `**`, `-`, `[`, `](url)`)
 * is drawn faded beside what it marks. The file stays plain Markdown. Pure.
 */

export type Span =
  | { kind: "marker"; start: number; end: number }
  | { kind: "heading"; start: number; end: number; level: number }
  | { kind: "bold" | "italic" | "strike" | "code" | "quote" | "done"; start: number; end: number }
  | { kind: "box"; start: number; end: number; line: number; checked: boolean }
  | { kind: "link"; start: number; end: number; url: string };

const HEADING = /^(#{1,6})([ \t]+)/;
const CHECK = /^([ \t]*)([-*+])([ \t]+)\[([ xX])\]/;
const BULLET = /^([ \t]*)([-*+])[ \t]+/;
const NUMBER = /^([ \t]*)(\d{1,9}[.)])[ \t]+/;
const QUOTE = /^>[ \t]?/;
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const FENCE = /^[ \t]*(```|~~~)/;

/** The spans of `body`, in the order they are drawn (a later one over an earlier). */
export function markup(body: string): Span[] {
  const spans: Span[] = [];
  let fenced = false;
  let at = 0;
  for (const [index, line] of body.split("\n").entries()) {
    const start = at;
    at += line.length + 1;
    if (FENCE.test(line)) {
      fenced = !fenced;
      spans.push({ kind: "marker", start, end: start + line.length });
      continue;
    }
    if (fenced) {
      if (line !== "") spans.push({ kind: "code", start, end: start + line.length });
      continue;
    }
    spans.push(...lineSpans(line, start, index));
  }
  return spans;
}

/** One line's spans: what it is (a heading, an item, a quote) and then its words. */
function lineSpans(line: string, start: number, index: number): Span[] {
  const spans: Span[] = [];
  const end = start + line.length;
  if (RULE.test(line) && line.trim() !== "") return [{ kind: "marker", start, end }];
  let rest = 0;
  const heading = HEADING.exec(line);
  const check = CHECK.exec(line);
  const bullet = BULLET.exec(line);
  const number = NUMBER.exec(line);
  const quote = QUOTE.exec(line);
  if (heading) {
    const level = heading[1]?.length ?? 1;
    spans.push({ kind: "heading", start, end, level });
    rest = heading[0].length;
    spans.push({ kind: "marker", start, end: start + rest });
  } else if (check) {
    const indent = check[1]?.length ?? 0;
    const box = indent + (check[2]?.length ?? 1) + (check[3]?.length ?? 1);
    const checked = check[4] !== " ";
    const boxEnd = check[0].length;
    rest = boxEnd + (/^[ \t]*/.exec(line.slice(boxEnd))?.[0].length ?? 0);
    spans.push({ kind: "marker", start: start + indent, end: start + box });
    if (checked && rest < line.length) spans.push({ kind: "done", start: start + rest, end });
    spans.push({ kind: "box", start: start + box, end: start + boxEnd, line: index, checked });
  } else if (bullet) {
    rest = bullet[0].length;
    spans.push({ kind: "marker", start: start + (bullet[1]?.length ?? 0), end: start + rest });
  } else if (number) {
    rest = number[0].length;
    spans.push({ kind: "marker", start: start + (number[1]?.length ?? 0), end: start + rest });
  } else if (quote) {
    rest = quote[0].length;
    spans.push({ kind: "quote", start, end });
    spans.push({ kind: "marker", start, end: start + rest });
  }
  spans.push(...inlineSpans(line.slice(rest), start + rest));
  return spans;
}

interface Found {
  start: number;
  end: number;
  spans: Span[];
}

/** Inline code, then links, bold, struck, and italic, none starting inside another. */
function inlineSpans(text: string, offset: number): Span[] {
  const found: Found[] = [];
  const free = (start: number, end: number): boolean => found.every((each) => end <= each.start || start >= each.end);
  const take = (pattern: RegExp, make: (match: RegExpExecArray, start: number, end: number) => Span[]): void => {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (free(start, end)) found.push({ start, end, spans: make(match as RegExpExecArray, offset + start, offset + end) });
    }
  };
  const wrapped = (kind: "bold" | "italic" | "strike" | "code", marker: number) => (_match: RegExpExecArray, start: number, end: number) => [
    { kind, start, end } as Span,
    { kind: "marker", start, end: start + marker } as Span,
    { kind: "marker", start: end - marker, end } as Span,
  ];
  take(/`[^`\n]+`/g, wrapped("code", 1));
  take(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, start, end) => {
    const words = match[1]?.length ?? 0;
    return [
      { kind: "marker", start, end: start + 1 },
      { kind: "link", start: start + 1, end: start + 1 + words, url: match[2] ?? "" },
      { kind: "marker", start: start + 1 + words, end },
    ];
  });
  take(/\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g, (match, start, end) => [{ kind: "link", start, end, url: match[0] }]);
  take(/\*\*(?=\S)[^\n]*?\S\*\*|__(?=\S)[^\n]*?\S__/g, wrapped("bold", 2));
  take(/~~(?=\S)[^\n]*?\S~~/g, wrapped("strike", 2));
  take(/(?<![*\w])\*(?=[^\s*])[^*\n]*?[^\s*]\*(?![*\w])|(?<![_\w])_(?=[^\s_])[^_\n]*?[^\s_]_(?![_\w])|(?<![*\w])\*[^\s*]\*(?![*\w])/g, wrapped("italic", 1));
  return found.sort((a, b) => a.start - b.start).flatMap((each) => each.spans);
}

/** The checklist box (or link) under body offset `at`, for a press. */
export function spanAt<K extends Span["kind"]>(spans: readonly Span[], kind: K, at: number): Extract<Span, { kind: K }> | null {
  for (const span of spans) if (span.kind === kind && span.start <= at && at <= span.end) return span as Extract<Span, { kind: K }>;
  return null;
}
