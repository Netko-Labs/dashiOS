/**
 * read_page's `items` mode: a page's repeated structure (search results, a
 * shop's grid, Marketplace's listings) as rows with fields, from the DOM's
 * own shape, no model: the container whose children most often share one
 * shape (tag, class, role), each holding a link; in each, the title (a
 * heading, else its link's words), a price (by its form), the link and its
 * number, and the other short texts in order (a place, a date, a seller).
 * Pure: tested with made-up trees.
 */

import { isLandmark } from "./main.ts";
import { collapse, isSkipped, type PageNode, roleOf } from "./node.ts";

export interface Item {
  /** The item's link, numbered as read_page numbers it (null: no link). */
  ref: number | null;
  title: string;
  price?: string;
  href?: string;
  details: string[];
}

const MAX_ITEMS = 100;
const MIN_ITEMS = 3;
const PRICE =
  /(?:[$€£¥₹]|\b(?:US\$|COP|USD|EUR|MXN|ARS|CLP|PEN|BRL|R\$)\s?)\s?\d[\d.,\s]*\d|\b\d[\d.,]*\s?(?:€|USD|EUR|COP|MXN|kr|zł)(?![a-z])|\bfree\b|\bgratis\b/i;

/** What fields hold is never read as an item's text. */
const FIELDS = new Set(["input", "textarea", "select", "option"]);

const shapeOf = (node: PageNode): string => `${node.tag}|${node.attr("class") ?? ""}|${node.attr("role") ?? ""}`;

function first(node: PageNode, wanted: (node: PageNode) => boolean, depth = 0): PageNode | null {
  if (depth > 40 || node.tag === "#text" || isSkipped(node)) return null;
  if (wanted(node)) return node;
  for (const child of node.children()) {
    const found = first(child, wanted, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The texts a node shows, in order, one for each run of text between blocks and elements. */
function texts(node: PageNode, out: string[] = [], depth = 0): string[] {
  if (depth > 40 || isSkipped(node) || FIELDS.has(node.tag)) return out;
  if (node.tag === "#text") {
    const text = collapse(node.text()).trim();
    if (text) {
      const last = out.length - 1;
      if (last >= 0 && !(out[last] ?? "").endsWith("\n")) out[last] = `${out[last]} ${text}`;
      else out.push(text);
    }
    return out;
  }
  if (node.tag === "img") {
    const alt = collapse(node.attr("alt") ?? "").trim();
    if (alt) out.push(`${alt}\n`);
    return out;
  }
  const breaks = node.block() || node.tag === "br" || roleOf(node) !== null;
  if (breaks && out.length > 0) out[out.length - 1] = `${out[out.length - 1]}\n`;
  for (const child of node.children()) texts(child, out, depth + 1);
  if (breaks && out.length > 0) out[out.length - 1] = `${out[out.length - 1]}\n`;
  return out;
}

const isLink = (node: PageNode): boolean => roleOf(node) === "link";
const isHeading = (node: PageNode): boolean => /^h[1-6]$/.test(node.tag) || node.attr("role") === "heading";

/** The children of `node` that make the best list: most of one shape, each with a link. */
function bestGroup(node: PageNode): PageNode[] {
  const counts = new Map<string, PageNode[]>();
  for (const child of node.children()) {
    if (child.tag === "#text" || isSkipped(child)) continue;
    const group = counts.get(shapeOf(child)) ?? [];
    group.push(child);
    counts.set(shapeOf(child), group);
  }
  let best: PageNode[] = [];
  for (const group of counts.values()) {
    const linked = group.filter((child) => isLink(child) || first(child, isLink) !== null);
    if (linked.length > best.length) best = linked;
  }
  return best;
}

/** Every link in a node (itself included), in order. */
function links(node: PageNode, out: PageNode[] = [], depth = 0): PageNode[] {
  if (depth > 40 || node.tag === "#text" || isSkipped(node)) return out;
  if (isLink(node)) out.push(node);
  for (const child of node.children()) links(child, out, depth + 1);
  return out;
}

const wordsOf = (node: PageNode): string => texts(node).join(" ").replace(/\s+/g, " ").trim();

/** An item's main link: the one with the most words (a story's title, not its author or "hide"). */
function mainLink(node: PageNode): PageNode | null {
  let best: { link: PageNode; length: number } | null = null;
  for (const link of links(node)) {
    const length = wordsOf(link).length;
    if (!best || length > best.length) best = { link, length };
  }
  return best?.link ?? null;
}

/** A group scores by how many it has and how much its main links say: rows of titles beat rows of "3 hours ago · hide". */
function score(group: PageNode[]): number {
  if (group.length < MIN_ITEMS) return 0;
  const sample = group.slice(0, 10);
  const length =
    sample.reduce((sum, item) => sum + Math.min(wordsOf(item).length, 200) + 2 * Math.min(wordsOf(mainLink(item) ?? item).length, 120), 0) / sample.length;
  return length < 15 ? 0 : group.length * length;
}

function findList(root: PageNode): PageNode[] {
  let best: { group: PageNode[]; score: number } = { group: [], score: 0 };
  const walk = (node: PageNode, depth: number) => {
    if (depth > 60 || node.tag === "#text" || isSkipped(node) || isLandmark(node)) return;
    const group = bestGroup(node);
    const each = score(group);
    if (each > best.score) best = { group, score: each };
    for (const child of node.children()) walk(child, depth + 1);
  };
  walk(root, 0);
  return best.group;
}

function itemOf(node: PageNode, refOf: (node: PageNode) => number, origin: string | null): Item {
  const link = mainLink(node);
  const several = links(node).length > 1;
  const heading = first(node, isHeading);
  const lines = texts(node)
    .map((line) => line.trim())
    .filter(Boolean);
  const headingText = heading ? texts(heading).join(" ").trim() : "";
  const linkText = link ? texts(link).join(" ").replace(/\s+/g, " ").trim() : "";
  const price = lines.map((line) => line.match(PRICE)?.[0]).find((match) => match !== undefined);
  // A heading names it; else, among several links, the main one's words (a card that is one link reads by its first line that is no price).
  const title =
    headingText || (several && linkText) || lines.find((line) => line !== price && !PRICE.test(line) && line.length > 3) || linkText || (lines[0] ?? "");
  const details = lines.filter((line) => line !== title && line !== price && !title.includes(line) && line.length <= 120).slice(0, 4);
  const href = link?.href() ?? null;
  return {
    ref: link ? refOf(link) : null,
    title: title.slice(0, 160),
    ...(price ? { price: price.trim() } : {}),
    ...(href ? { href: origin && href.startsWith(`${origin}/`) ? href.slice(origin.length) : href } : {}),
    details: details.map((detail) => detail.slice(0, 80)),
  };
}

/** The page's repeated items, at most 100; empty when it has no list of at least three. */
export function readItems(root: PageNode, refOf: (node: PageNode) => number, origin: string | null = null): Item[] {
  return findList(root)
    .slice(0, MAX_ITEMS)
    .map((node) => itemOf(node, refOf, origin));
}
