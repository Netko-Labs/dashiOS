/**
 * An extension's view as the launcher's own rows (tree-scope.ts draws them):
 * a List's sections and items, a Grid's cells, a Detail's Markdown and facts,
 * an EmptyView; and an item's ActionPanel as its verbs, with keys. Pure, so
 * the tests read it: nothing here is drawn by the extension.
 */

import { join } from "node:path";
import { isRefusal, parseGlyph, type ViewNode } from "@dashi/applet";
import type { Row, RowIcon, Tone } from "../row-model.ts";
import type { Section } from "../sections.ts";
import { KEYS, type Verb } from "../verbs.ts";
import { EXTENSION_GLYPH } from "./extension-rows.ts";

const prop = (node: ViewNode, name: string): string | undefined => {
  const value = node.p[name];
  return typeof value === "string" ? value : undefined;
};

const TONES: readonly Tone[] = ["primary", "secondary", "tertiary", "accent", "ume", "broth", "moss"];
export const toneOf = (node: ViewNode): Tone | undefined => {
  const tone = prop(node, "tone");
  return TONES.find((each) => each === tone);
};

/** A row's id for a node, and back. */
export const rowId = (node: ViewNode): string => `tree:${node.i}`;
export const nodeIdOf = (row: Row | undefined): string | null => (row?.id.startsWith("tree:") ? row.id.slice(5) : null);

/** The picture an Image node names: the package's file, its glyph in a tone, or an emoji. */
export function iconOf(node: ViewNode | undefined, dir: string | null, fallback: RowIcon): RowIcon {
  if (!node) return fallback;
  const emoji = prop(node, "emoji");
  if (emoji) return { text: emoji };
  const svg = prop(node, "svg");
  const tone = toneOf(node);
  // The menu bar glyph's rules (one <svg>, nothing that loads, links, styles or runs); one that breaks them isn't drawn.
  const glyph = svg ? parseGlyph(svg) : null;
  if (glyph && !isRefusal(glyph)) return { glyph, ...(tone ? { tone } : {}) };
  const src = prop(node, "src");
  // Only the package's own files, never a path outside it (the tree is checked: `src` is a plain path).
  if (src && dir && !src.startsWith("/") && !src.split("/").includes("..")) return { image: join(dir, src) };
  return fallback;
}

/** Whether `query`'s words each start a word of the item (its title, subtitle, keywords). */
export function itemMatches(node: ViewNode, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const keywords = node.p.keywords;
  const text = [prop(node, "title"), prop(node, "subtitle"), ...(Array.isArray(keywords) ? keywords : [])].join(" ").toLowerCase();
  const own = text.split(/[^\p{L}\p{N}]+/u);
  return words.every((word) => own.some((each) => each.startsWith(word)) || text.includes(word));
}

/** An item as a row: its picture, its title and subtitle, its tags and words at the right. */
export function itemRow(node: ViewNode, ctx: { dir: string | null; from: string }): Row {
  const children = node.c;
  const tags = children
    .filter((child) => child.t === "Tag")
    .map((child) => ({ text: prop(child, "text") ?? "", ...(toneOf(child) ? { tone: toneOf(child) } : {}) }));
  const words = children
    .filter((child) => child.t === "Text")
    .map((child) => prop(child, "text") ?? "")
    .join(" · ");
  const subtitle = prop(node, "subtitle");
  return {
    id: rowId(node),
    title: prop(node, "title") ?? "",
    ...(subtitle ? { detail: subtitle } : {}),
    kind: words,
    icon: iconOf(
      children.find((child) => child.t === "Image"),
      ctx.dir,
      { glyph: EXTENSION_GLYPH },
    ),
    action: { kind: "scope", verb: "first" },
    long: true,
    ...(tags.length > 0 ? { tags } : {}),
  };
}

/** Rows a long list shows at once (fewer at a larger text size: list.tsx). */
export const LIST_WINDOW = 10;

/** Lines of cells a grid shows at once. */
export const GRID_LINES = 4;

/** What the view's body is besides rows: a grid's columns, a detail's Markdown and facts. */
export interface DetailPart {
  markdown: string;
  facts: readonly ViewNode[];
}

/** A view as sections, for what is typed (the launcher filters a List or Grid that says `filter: "launcher"`). */
export function treeSections(root: ViewNode, query: string, ctx: { dir: string | null; from: string }): Section[] {
  if (root.t === "Detail") {
    const metadata = root.c.find((child) => child.t === "Metadata");
    const detail: DetailPart = { markdown: prop(root, "markdown") ?? "", facts: metadata?.c ?? [] };
    // One row stands for the detail (↩ and ❖K act on it); the rest of the room is the detail's.
    return [
      {
        id: "tree:detail",
        rows: [{ id: rowId(root), title: "", kind: "", icon: { none: true }, action: { kind: "scope", verb: "first" } }],
        reserved: 11,
        detail,
      },
    ];
  }
  const filtering = prop(root, "filter") !== "extension";
  const grid = root.t === "Grid" ? (typeof root.p.columns === "number" ? root.p.columns : 8) : undefined;
  const keep = (item: ViewNode): boolean => item.t === "Item" && (!filtering || itemMatches(item, query));
  const loose = root.c.filter(keep);
  const sections: Section[] = [
    ...(loose.length > 0 ? [{ id: "tree:loose", rows: loose.map((item) => itemRow(item, ctx)), ...(grid ? { grid } : {}) }] : []),
    ...root.c
      .filter((child) => child.t === "Section")
      .map((section) => ({ section, items: section.c.filter(keep) }))
      .filter(({ items }) => items.length > 0)
      .map(({ section, items }) => {
        const title = prop(section, "title");
        const aside = prop(section, "subtitle");
        return {
          id: rowId(section),
          ...(title ? { title } : {}),
          ...(aside ? { aside } : {}),
          rows: items.map((item) => itemRow(item, ctx)),
          ...(grid ? { grid } : {}),
        };
      }),
  ];
  // A grid is one window of cells, scrolled with the selection: GRID_LINES lines of cells, each two rows tall (tree-view.tsx).
  if (grid && sections.length > 0) {
    const [only] = sections;
    return [
      {
        id: "tree:grid",
        ...(sections.length === 1 && only?.title ? { title: only.title } : {}),
        rows: sections.flatMap((section) => section.rows),
        grid,
        window: GRID_LINES * 2,
      },
    ];
  }
  // A long list is one window of rows that scrolls with the selection (as a scope's): cut to the panel, its last rows
  // could never be reached. One section keeps its head; several become one, under the first's.
  const count = sections.reduce((sum, section) => sum + section.rows.length, 0);
  if (count > LIST_WINDOW) {
    const [first] = sections;
    return [
      {
        id: "tree:list",
        ...(first?.title ? { title: first.title } : {}),
        ...(first?.aside && sections.length === 1 ? { aside: first.aside } : {}),
        rows: sections.flatMap((section) => section.rows),
        window: LIST_WINDOW,
      },
    ];
  }
  if (sections.length > 0) return sections;
  return [emptySection(root, query, ctx)];
}

/** No item to show: the extension's EmptyView, or the launcher's own words. */
function emptySection(root: ViewNode, query: string, ctx: { dir: string | null; from: string }): Section {
  const empty = root.c.find((child) => child.t === "EmptyView");
  const title = empty ? (prop(empty, "title") ?? "") : query.trim() ? `Nothing in ${ctx.from} for “${query.trim()}”` : "Nothing here";
  const description = empty ? prop(empty, "description") : undefined;
  return {
    id: "tree:empty",
    rows: [
      {
        id: empty ? rowId(empty) : "tree:empty",
        title,
        ...(description ? { detail: description } : {}),
        kind: "",
        icon: iconOf(
          empty?.c.find((child) => child.t === "Image"),
          ctx.dir,
          { glyph: EXTENSION_GLYPH },
        ),
        action: { kind: "scope", verb: "first" },
      },
    ],
  };
}

/** "mod+c" → ❖C, "shift+mod+enter" → ⇧❖↩: an action's key as the launcher draws keys. */
export function keyOf(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined;
  const names: Record<string, string> = { mod: "❖", shift: "⇧", alt: "⌥", ctrl: "⌃", enter: "↩", return: "↩", backspace: "⌫", delete: "⌦" };
  return shortcut
    .toLowerCase()
    .split("+")
    .map((part) => names[part] ?? part.toUpperCase())
    .join("");
}

/** The ActionPanel that goes with a node: its own, else the view's. */
export function panelOf(node: ViewNode | undefined, root: ViewNode): ViewNode | undefined {
  return node?.c.find((child) => child.t === "ActionPanel") ?? root.c.find((child) => child.t === "ActionPanel");
}

/** A panel's actions as verbs, in order: the first is ↩ and the second ❖↩ unless they name their own key. */
export function panelVerbs(panel: ViewNode | undefined): Verb[] {
  const actions = (panel?.c ?? []).flatMap((child) => (child.t === "ActionSection" ? child.c : [child])).filter((child) => child.t === "Action");
  return actions.map((action, at) => {
    const own = keyOf(prop(action, "shortcut"));
    const key = own ?? (at === 0 ? KEYS.primary : at === 1 ? KEYS.secondary : undefined);
    return {
      id: action.i,
      title: prop(action, "title") ?? "",
      effect: { kind: "scope", verb: action.i },
      ...(key ? { key } : {}),
      ...(action.p.danger === true ? { danger: true as const } : {}),
    };
  });
}
