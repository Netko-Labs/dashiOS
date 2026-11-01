/**
 * AppStream descriptions are a small HTML subset (`<p>`, `<ul>`, `<ol>`,
 * `<li>`, `<em>`, `<code>`), written by app authors: untrusted. They are
 * turned into plain-text blocks and never interpreted: every tag is dropped
 * (script and style contents with it), entities are decoded to text, and the
 * result is cut to sane lengths. Nothing here produces markup.
 */

import { tidy } from "./text.ts";

const MAX_INPUT = 60_000;
const MAX_BLOCKS = 40;
const MAX_BLOCK = 1_500;

const NAMED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", bull: "•" };

/** `&amp;`, `&#39;`, `&#x2019;` as text; an entity it does not know stays as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return NAMED[name] ?? whole;
    const code = dec !== undefined ? Number(dec) : Number.parseInt(hex ?? "", 16);
    if (!Number.isInteger(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
    return String.fromCodePoint(code);
  });
}

type Token = { tag: string; closing: boolean } | { text: string };

function tokens(html: string): Token[] {
  const out: Token[] = [];
  // Comments and CDATA go first; then tags, then the text between them.
  const source = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?\/?>|[^<]+|</g;
  for (const match of source.matchAll(pattern)) {
    if (match[2] !== undefined) out.push({ tag: match[2].toLowerCase(), closing: match[1] === "/" });
    else out.push({ text: match[0] });
  }
  return out;
}

/**
 * The description as paragraphs of plain text. List items become their own
 * paragraphs with a bullet (or "1." for numbered lists).
 */
export function descriptionBlocks(html: string): string[] {
  const blocks: string[] = [];
  let current = "";
  let skipping: string | null = null;
  const lists: Array<{ ordered: boolean; count: number }> = [];
  let marker = "";

  const flush = (): void => {
    const text = tidy(decodeEntities(current), MAX_BLOCK);
    if (text !== "") blocks.push(marker ? `${marker} ${text}` : text);
    current = "";
    marker = "";
  };

  for (const token of tokens(html.slice(0, MAX_INPUT))) {
    if ("text" in token) {
      if (skipping === null) current += token.text;
      continue;
    }
    const { tag, closing } = token;
    if (skipping !== null) {
      if (closing && tag === skipping) skipping = null;
      continue;
    }
    if (tag === "script" || tag === "style") {
      if (!closing) skipping = tag;
    } else if (tag === "ul" || tag === "ol") {
      flush();
      if (closing) lists.pop();
      else lists.push({ ordered: tag === "ol", count: 0 });
    } else if (tag === "li") {
      flush();
      if (!closing) {
        const list = lists[lists.length - 1];
        if (list) list.count++;
        marker = list?.ordered ? `${list.count}.` : "•";
      }
    } else if (tag === "p" || tag === "br" || tag === "div" || tag === "h1" || tag === "h2" || tag === "h3") {
      if (tag === "br" && !closing) current += " ";
      else flush();
    }
    if (blocks.length >= MAX_BLOCKS) break;
  }
  flush();
  return blocks.slice(0, MAX_BLOCKS);
}

/** One line of plain text from a description (search results show the first lines of it). */
export function plainLine(html: string, max: number): string {
  return tidy(descriptionBlocks(html).join(" "), max);
}
