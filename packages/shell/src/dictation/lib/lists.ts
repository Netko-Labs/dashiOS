/**
 * A list said aloud (compose.ts; research 1.9, "spoken structure"), made by
 * rule where its markers are plain: "first… second… third…", "one, … two, …
 * three, …", "bullet point … bullet point …", and the Spanish forms. The
 * markers go, each item gets its own line, and what came before the first
 * one introduces them. Where the pattern is not plain nothing is made: the
 * model does the rest when it is there.
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
const BULLET = /\b(?:bullet point|next bullet|next item|bullet|viñeta|siguiente punto)\b[,:]?/giu;

/** After one of these an ordinal is a describing word, not a marker ("the first time"). */
const NOT_A_MARKER_AFTER = new Set(
  "the a an my your his her our their this that these those of in on at for to from every each its el la los las un una mi tu su del al en de por".split(" "),
);
/** Before one of these too ("first of all", "second thoughts"). */
const NOT_A_MARKER_BEFORE = new Set("of time times place one thing things half name person day year floor thoughts hand vez lugar".split(" "));

interface Marker {
  at: number;
  end: number;
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
  return [...text.matchAll(BULLET)].map((match) => ({ at: match.index, end: match.index + match[0].length }));
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

/**
 * The list `text` holds, with its markers gone; null when it holds none that is plain. Numbered when the items were
 * counted, else a Markdown bullet each, or bare lines in a plain field.
 */
export function makeList(text: string, style: "markdown" | "plain"): Listed | null {
  if (text.includes("\n")) return null;
  const ordinals = inOrder(text, ORDINALS, false);
  const cardinals = ordinals.length >= 2 ? [] : inOrder(text, CARDINALS, true);
  const marks = ordinals.length >= 2 ? ordinals : cardinals.length >= 3 ? cardinals : bullets(text);
  const numbered = ordinals.length >= 2 || cardinals.length >= 3;
  if (marks.length < 2) return null;
  const items = marks.map((mark, index) => item(text.slice(mark.end, marks[index + 1]?.at ?? text.length)));
  if (items.some((each) => each === "")) return null;
  const lines = items.map((each, index) => (numbered ? `${index + 1}. ${each}` : style === "markdown" ? `- ${each}` : each));
  const lead = intro(text.slice(0, marks[0]?.at ?? 0));
  return { text: [...(lead ? [lead] : []), ...lines].join("\n"), items: items.length };
}
