/**
 * A list said aloud (compose.ts; research 1.9, "spoken structure"), made by
 * rule where its markers are plain: "first… second… third…", "one, … two, …
 * three, …", "bullet point … bullet point …", and the Spanish forms. The
 * markers go, each item gets its own line, and what came before the first
 * one introduces them. Where the pattern is not plain nothing is made: the
 * model does the rest when it is there.
 *
 * "New bullet point" (and "next bullet", "nueva viñeta", "punto nuevo") is a
 * formatting command said inline, with no pause (D301): taken whole, "new"
 * and all, and one is enough to start an item. A bare "bullet point" needs a
 * second, so "use a bullet point here" stays words.
 */

const ORDINALS: readonly (readonly string[])[] = [
  ["first", "firstly", "primero"],
  ["second", "secondly", "segundo"],
  ["third", "thirdly", "tercero"],
  ["fourth", "cuarto"],
  ["fifth", "quinto"],
  ["sixth", "sexto"],
];
const CARDINALS: readonly (readonly string[])[] = [
  ["one", "uno"],
  ["two", "dos"],
  ["three", "tres"],
  ["four", "cuatro"],
  ["five", "cinco"],
  ["six", "seis"],
];
/** A bullet said aloud; never after an article ("a new bullet point", "un punto nuevo" are words). */
const BULLET =
  /(?<!\b(?:a|an|the|this|that|my|your|one|un|una|el|la|este|esta|ese|esa|mi|tu|su)\s)\b(?:(?:new|next|another)\s+bullet(?:\s+point)?|new\s+item|bullet\s+point|next\s+item|bullet|(?:nueva|otra|siguiente)\s+viñeta|viñeta|punto\s+nuevo|nuevo\s+punto|siguiente\s+punto)\b[,:.]?/giu;
/** A bullet that says it starts a new item: one alone is a command, not a word. */
const EXPLICIT = /^(?:new|next\s+bullet|another|nueva|otra|siguiente\s+viñeta|punto\s+nuevo|nuevo)/iu;

/** After one of these an ordinal is a describing word, not a marker ("the first time"). */
const NOT_A_MARKER_AFTER = new Set(
  "the a an my your his her our their this that these those of in on at for to from every each its el la los las un una mi tu su del al en de por".split(" "),
);
/** Before one of these too ("first of all", "second thoughts"). */
const NOT_A_MARKER_BEFORE = new Set("of time times place one thing things half name person day year floor thoughts hand vez lugar".split(" "));

interface Marker {
  at: number;
  end: number;
  /** "New bullet point": an item even when it is the only one. */
  explicit?: boolean;
}

/** Where the markers of `series` stand, in order from its first; `strict` wants each at the start or after a mark. */
function inOrder(text: string, series: readonly (readonly string[])[], strict: boolean): Marker[] {
  const found: Marker[] = [];
  let from = 0;
  for (const forms of series) {
    const marker = new RegExp(`\\b(?:number |número )?(?:${forms.join("|")})\\b[,:]?`, "giu");
    marker.lastIndex = from;
    let hit: Marker | null = null;
    for (let match = marker.exec(text); match; match = marker.exec(text)) {
      const before = text.slice(0, match.index).trimEnd();
      const after = text.slice(match.index + match[0].length).trimStart();
      const wordBefore = /[\p{L}\p{N}'’]+$/u.exec(before)?.[0].toLowerCase();
      const wordAfter = /^[\p{L}\p{N}'’]+/u.exec(after)?.[0].toLowerCase();
      const afterMark = before === "" || /[.,;:!?\n]$/.test(before);
      if (strict ? !afterMark : wordBefore !== undefined && !afterMark && NOT_A_MARKER_AFTER.has(wordBefore)) continue;
      if (wordAfter === undefined || NOT_A_MARKER_BEFORE.has(wordAfter)) continue;
      hit = { at: match.index, end: match.index + match[0].length };
      break;
    }
    if (!hit) break;
    found.push(hit);
    from = hit.end;
  }
  return found;
}

function bullets(text: string): Marker[] {
  return [...text.matchAll(BULLET)].map((match) => ({ at: match.index, end: match.index + match[0].length, explicit: EXPLICIT.test(match[0]) }));
}

/** An item's words: no joining mark or "and" round them, a capital first. */
function item(text: string): string {
  const words = text
    .trim()
    .replace(/^[,;:.\s]+/, "")
    .replace(/[,;.\s]+$/, "")
    .replace(/[,;]?\s+(?:and|y|then|luego)$/i, "")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What comes before the first item, as the line that introduces them. */
function intro(text: string): string {
  const words = text.trim().replace(/[,;.:\s]+$/, "");
  return words === "" ? "" : `${words}:`;
}

export interface Listed {
  text: string;
  items: number;
}

/** A bullet item's mark: Markdown's where it is drawn, the bullet itself in plain text (D301). */
const bulletMark = (style: "markdown" | "plain"): string => (style === "markdown" ? "- " : "• ");

/** The list one line holds, or null; `first` is the utterance's first line, where a lone "new bullet point" starts a line of its own. */
function listLine(text: string, style: "markdown" | "plain", first: boolean): Listed | null {
  const ordinals = inOrder(text, ORDINALS, false);
  const cardinals = ordinals.length >= 2 ? [] : inOrder(text, CARDINALS, true);
  const marks = ordinals.length >= 2 ? ordinals : cardinals.length >= 3 ? cardinals : bullets(text);
  const numbered = ordinals.length >= 2 || cardinals.length >= 3;
  if (marks.length < 2 && !marks[0]?.explicit) return null;
  const items = marks.map((mark, index) => item(text.slice(mark.end, marks[index + 1]?.at ?? text.length)));
  if (items.some((each) => each === "")) return null;
  const lines = items.map((each, index) => `${numbered ? `${index + 1}. ` : bulletMark(style)}${each}`);
  const lead = intro(text.slice(0, marks[0]?.at ?? 0));
  // "New bullet point milk" said on its own goes on a new line after what is already there (fit.ts drops it at a line's start).
  const head = lead ? [lead] : first && marks[0]?.explicit ? [""] : [];
  return { text: [...head, ...lines].join("\n"), items: items.length };
}

/**
 * The list `text` holds, with its markers gone; null when it holds none that is plain. Numbered when the items were
 * counted, else a bullet each: Markdown's, or "•" in a plain field. Each line said ("new line") is its own.
 */
export function makeList(text: string, style: "markdown" | "plain"): Listed | null {
  let items = 0;
  const lines = text.split("\n").map((line, index) => {
    const listed = line.trim() === "" ? null : listLine(line, style, index === 0);
    items += listed?.items ?? 0;
    return listed?.text ?? line;
  });
  return items === 0 ? null : { text: lines.join("\n"), items };
}
