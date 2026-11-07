/**
 * Dashi's file and folder icons (design.html IC-2): one recipe for every
 * place a file shows (Files, the chooser, a drag). A document is a page with
 * a folded corner, white in Light and graphite in Dark, with its category's
 * glyph in that category's tint; a type with no category gets a blank page
 * and its extension as a label (file-icon.tsx draws the label). A folder is
 * mizu blue, and a special folder (Documents, Downloads…) carries the
 * sidebar's glyph for it as an emblem. The pictures are SVG documents built
 * here and written once to the cache, so an Image (and a drag) can show
 * them; no icon theme is mixed in.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sidebarGlyph } from "./glyphs.ts";
import type { GlyphName } from "./location.ts";
import { type Category, categoryOf, INODE_DIRECTORY } from "./mime.ts";
import { cacheHome } from "./xdg.ts";

/** The document categories with a glyph of their own, and the tint each wears (@dashi/ui TINTS). */
export const CATEGORY_TINTS: Readonly<Record<Exclude<Category, "folder" | "other">, string>> = {
  image: "#6F8A2A",
  audio: "#C66F22",
  video: "#3D7AB0",
  archive: "#A06C35",
  code: "#2B8597",
  text: "#706C66",
  document: "#4A6478",
};

/** The emblems a special folder can carry: the sidebar's glyph for it. */
export type Emblem = Extract<GlyphName, "home" | "desktop" | "documents" | "downloads" | "pictures" | "music" | "videos">;

export type IconKind = { folder: true; emblem?: Emblem } | { folder: false; category: Exclude<Category, "folder"> };

/** Colors for one appearance. */
export interface IconInk {
  page: [string, string];
  edge: string;
  fold: string;
  folderBack: [string, string];
  folderFront: [string, string];
  emblem: string;
  /** A category's glyph drawn lighter than its tint, where the tint is too dim on this page (Dark Mode's text and documents). */
  lift: Partial<Record<keyof typeof CATEGORY_TINTS, string>>;
}

export const LIGHT_INK: IconInk = {
  page: ["#ffffff", "#f1f2f5"],
  edge: "#1d1d1f29",
  fold: "#dfe1e6",
  folderBack: ["#5d93c3", "#4a82b6"],
  folderFront: ["#8cbbe2", "#69a1d2"],
  emblem: "#2f6493b3",
  lift: {},
};

export const DARK_INK: IconInk = {
  page: ["#3d3d42", "#333337"],
  edge: "#ffffff29",
  fold: "#55555b",
  folderBack: ["#45739e", "#3a6590"],
  folderFront: ["#6f9fc9", "#5687b5"],
  emblem: "#1f4466c7",
  lift: { text: "#aaa59e", document: "#8aa3b8", archive: "#c08a52" },
};

/** The 16-unit glyphs drawn on a page, stroked in the category's tint. */
const PAGE_GLYPHS: Readonly<Record<Exclude<Category, "folder" | "other">, string>> = {
  image: '<rect x="2" y="3" width="12" height="10" rx="1.6"/><circle cx="5.6" cy="6.2" r="1.1"/><path d="M2.6 11.6l3.6-3.4 2.6 2.4 2-1.8 2.6 2.4"/>',
  audio: '<path d="M6.2 11.6V3.6l6.4-1.4v8"/><circle cx="4.6" cy="11.8" r="1.8"/><circle cx="11" cy="10.4" r="1.8"/>',
  video: '<rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.6"/><path d="M6.6 6l3.4 2-3.4 2z"/>',
  archive:
    '<rect x="3" y="1.8" width="10" height="12.4" rx="1.6"/><path d="M8 2v1.6M8 5v1.6M8 8v1.4"/><rect x="6.8" y="9.6" width="2.4" height="2.6" rx=".6"/>',
  code: '<path d="M5.4 4.4L1.8 8l3.6 3.6M10.6 4.4L14.2 8l-3.6 3.6M9.2 3.2L6.8 12.8"/>',
  text: '<path d="M2.6 3.4h10.8M2.6 6.5h10.8M2.6 9.6h10.8M2.6 12.7h6.4"/>',
  document: '<path d="M2.6 3.4h7M2.6 6.8h10.8M2.6 9.6h10.8M2.6 12.4h10.8"/>',
};

const gradient = (id: string, [top, bottom]: [string, string]): string =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;

/** A sidebar glyph's drawing, recolored and placed: its strokes and fills in `color`. */
function emblemMarkup(name: Emblem, color: string): string {
  const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(sidebarGlyph(name))?.[1] ?? "";
  return `<g transform="translate(22 26) scale(1.25)">${inner.replaceAll("#000", color)}</g>`;
}

/** The SVG document for an icon in one appearance (64 units square). */
export function iconMarkup(kind: IconKind, ink: IconInk): string {
  const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">';
  if (kind.folder) {
    return [
      open,
      `<defs>${gradient("b", ink.folderBack)}${gradient("f", ink.folderFront)}</defs>`,
      '<path d="M6 14a4 4 0 0 1 4-4h14l6 6h24a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" fill="url(#b)"/>',
      '<path d="M6 24a4 4 0 0 1 4-4h44a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" fill="url(#f)"/>',
      '<path d="M10 20.5h44" stroke="#fff" stroke-opacity=".35" stroke-width="1"/>',
      kind.emblem ? emblemMarkup(kind.emblem, ink.emblem) : "",
      "</svg>",
    ].join("");
  }
  const glyph =
    kind.category === "other"
      ? ""
      : `<g transform="translate(21 27) scale(1.5)" fill="none" stroke="${ink.lift[kind.category] ?? CATEGORY_TINTS[kind.category]}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${PAGE_GLYPHS[kind.category]}</g>`;
  return [
    open,
    `<defs>${gradient("p", ink.page)}</defs>`,
    `<path d="M14 6a3 3 0 0 1 3-3h22l13 13v42a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z" fill="url(#p)" stroke="${ink.edge}"/>`,
    `<path d="M39 3v10a3 3 0 0 0 3 3h10z" fill="${ink.fold}"/>`,
    glyph,
    "</svg>",
  ].join("");
}

/** What kind of icon an item gets. */
export function iconKind(item: { kind: string; mime: string }, emblem?: Emblem): IconKind {
  if (item.kind === "folder" || item.mime === INODE_DIRECTORY) return emblem ? { folder: true, emblem } : { folder: true };
  const category = categoryOf(item.mime);
  return { folder: false, category: category === "folder" ? "other" : category };
}

const kindKey = (kind: IconKind): string => (kind.folder ? `folder${kind.emblem ? `-${kind.emblem}` : ""}` : kind.category);

const written = new Map<string, string>();

/** Where the icon's picture is on disk, written there the first time it is asked for (the cache's `dashi/file-icons`). */
export function iconFile(kind: IconKind, dark: boolean, cacheDir: string = cacheHome()): string {
  const markup = iconMarkup(kind, dark ? DARK_INK : LIGHT_INK);
  const name = `${kindKey(kind)}-${dark ? "dark" : "light"}-${Bun.hash(markup).toString(36)}.svg`;
  const dir = join(cacheDir, "dashi", "file-icons");
  const path = join(dir, name);
  const known = written.get(path);
  if (known) return known;
  try {
    if (!existsSync(path)) {
      mkdirSync(dir, { recursive: true });
      // Another window may read it meanwhile: it appears whole or not at all.
      const partial = `${path}.${process.pid}.tmp`;
      writeFileSync(partial, markup);
      renameSync(partial, path);
    }
  } catch {
    // An unwritable cache leaves the picture missing, never the listing.
  }
  written.set(path, path);
  return path;
}
