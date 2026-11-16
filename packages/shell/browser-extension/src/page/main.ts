/**
 * read_page's `main` mode: the part of a page that is its content, without
 * the menus, the header, the footer, the legal links and the suggestions
 * around it. The page's own `<main>` (or role=main) when it has one; else its
 * one article; else, from the body down, the block that holds most of the
 * text, as long as one does. Landmarks inside (nav, footer, aside, search)
 * are left out of what is read. Pure: tested with made-up trees.
 */

import { isSkipped, type PageNode, textOf } from "./node.ts";

const LANDMARK_TAGS = new Set(["nav", "header", "footer", "aside"]);
const LANDMARK_ROLES = new Set(["navigation", "banner", "contentinfo", "complementary", "search"]);

/** A part of a page that is around its content, not content: menus, header, footer, sidebars. */
export function isLandmark(node: PageNode): boolean {
  if (node.tag === "#text") return false;
  return LANDMARK_TAGS.has(node.tag) || LANDMARK_ROLES.has((node.attr("role") ?? "").toLowerCase());
}

function findAll(node: PageNode, wanted: (node: PageNode) => boolean, out: PageNode[] = [], depth = 0): PageNode[] {
  if (depth > 200 || node.tag === "#text" || isSkipped(node)) return out;
  if (wanted(node)) {
    out.push(node);
    return out;
  }
  for (const child of node.children()) findAll(child, wanted, out, depth + 1);
  return out;
}

const size = (node: PageNode): number => textOf(node).replace(/\s+/g, " ").trim().length;

/** Of a node's children, the one that holds most of its text (at least `share` of it), if one does. */
function holder(node: PageNode, share: number): PageNode | null {
  const children = node.children().filter((child) => child.tag !== "#text" && !isSkipped(child) && !isLandmark(child));
  const total = children.reduce((sum, child) => sum + size(child), 0);
  if (total === 0) return null;
  const biggest = children.reduce<{ node: PageNode | null; size: number }>(
    (best, child) => {
      const each = size(child);
      return each > best.size ? { node: child, size: each } : best;
    },
    { node: null, size: 0 },
  );
  return biggest.node && biggest.size >= total * share ? biggest.node : null;
}

/** Whether a node is a container: two or more elements in it. */
const holdsBlocks = (node: PageNode): boolean => node.children().filter((child) => child.tag !== "#text" && !isSkipped(child)).length >= 2;

/** The node whose text is the page's main content (the root itself when nothing narrower holds it). */
export function pickMain(root: PageNode): PageNode {
  const [main] = findAll(root, (node) => node.tag === "main" || (node.attr("role") ?? "").toLowerCase() === "main");
  if (main) return main;
  const articles = findAll(root, (node) => node.tag === "article");
  if (articles.length === 1 && articles[0]) return articles[0];
  if (articles.length > 1) {
    // A feed of articles: their nearest block, not one of them.
    const sizes = articles.map(size);
    const total = sizes.reduce((a, b) => a + b, 0);
    const top = Math.max(...sizes);
    const index = sizes.indexOf(top);
    if (top >= total * 0.6 && articles[index]) return articles[index];
  }
  let node = root;
  const whole = size(root);
  for (let depth = 0; depth < 30; depth++) {
    const next = holder(node, 0.7);
    // Never narrower than half the page's text, and never into a block with no blocks in it: a long paragraph is not the page.
    if (!next || size(next) < whole * 0.5 || !holdsBlocks(next)) break;
    node = next;
  }
  return node;
}
