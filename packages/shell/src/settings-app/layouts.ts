/**
 * The keyboard layouts xkb knows, read from the rules file that lists them
 * (`/usr/share/X11/xkb/rules/evdev.lst`), and the search over them. The file
 * is plain text in sections:
 *
 *   ! layout
 *     de              German
 *   ! variant
 *     nodeadkeys      de: German (no dead keys)
 *
 * A line that does not fit its section's shape is skipped, never guessed at;
 * names must be what the compositor accepts for `keyboard.layout`. Layouts come
 * back sorted by name, variants in the file's order (their own order matters:
 * the common ones come first).
 */

import { readFileSync } from "node:fs";

export const EVDEV_LST = "/usr/share/X11/xkb/rules/evdev.lst";

export interface XkbLayout {
  /** The xkb name ("de"). */
  id: string;
  /** What it is called ("German"). */
  name: string;
}

export interface XkbVariant {
  id: string;
  /** The layout it belongs to. */
  layout: string;
  name: string;
}

export interface XkbLayouts {
  layouts: XkbLayout[];
  variants: XkbVariant[];
}

/** xkb names: letters, digits, `_`, `-`; short. */
const NAME = /^[A-Za-z0-9_-]{1,32}$/;
const LAYOUT_LINE = /^\s+(\S+)\s+(\S.*?)\s*$/;
const VARIANT_LINE = /^\s+(\S+)\s+([A-Za-z0-9_-]{1,32}):\s+(\S.*?)\s*$/;

/** Layouts that are placeholders rather than something to type with. */
const NOT_REAL = new Set(["custom"]);

export function parseLayouts(text: string): XkbLayouts {
  const layouts: XkbLayout[] = [];
  const variants: XkbVariant[] = [];
  const seenLayouts = new Set<string>();
  const seenVariants = new Set<string>();
  let section: "layout" | "variant" | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("!")) {
      const name = line.slice(1).trim();
      section = name === "layout" || name === "variant" ? name : null;
      continue;
    }
    if (section === "layout") {
      const match = LAYOUT_LINE.exec(line);
      const id = match?.[1];
      const name = match?.[2];
      if (!id || !name || !NAME.test(id) || NOT_REAL.has(id) || seenLayouts.has(id)) continue;
      seenLayouts.add(id);
      layouts.push({ id, name });
    } else if (section === "variant") {
      const match = VARIANT_LINE.exec(line);
      const id = match?.[1];
      const layout = match?.[2];
      const name = match?.[3];
      if (!id || !layout || !name || !NAME.test(id)) continue;
      const key = `${layout}/${id}`;
      if (seenVariants.has(key)) continue;
      seenVariants.add(key);
      variants.push({ id, layout, name });
    }
  }
  // The file groups layouts by language; people look them up by name.
  layouts.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  // Only variants of a layout that is listed can be chosen.
  return { layouts, variants: variants.filter((variant) => seenLayouts.has(variant.layout)) };
}

/** The installed rules file; empty when it cannot be read (the pane then says so). */
export function loadLayouts(path: string = EVDEV_LST): XkbLayouts {
  try {
    return parseLayouts(readFileSync(path, "utf8"));
  } catch {
    return { layouts: [], variants: [] };
  }
}

/** Layouts matching `query` by name or id: exact id, then id or name prefix, word start, anywhere. Everything for an empty query. */
export function searchLayouts(layouts: readonly XkbLayout[], query: string): XkbLayout[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...layouts];
  const score = (layout: XkbLayout): number => {
    const name = layout.name.toLowerCase();
    if (layout.id === q) return 0;
    if (name.startsWith(q) || layout.id.startsWith(q)) return 1;
    if (name.split(/[\s\-_.,()]+/).some((word) => word.startsWith(q))) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  return layouts
    .map((layout, order) => ({ layout, score: score(layout), order }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(({ layout }) => layout);
}

/** The variants of one layout, in the file's order. */
export function variantsOf(variants: readonly XkbVariant[], layout: string): XkbVariant[] {
  return variants.filter((variant) => variant.layout === layout);
}

/** The first layout of an xkb list ("us,de" is "us"); "us" when none is set, which is xkb's own default. */
export function primaryLayout(list: string | undefined): string {
  return list?.split(",")[0]?.trim() || "us";
}

/** A name for a (possibly several) layouts value, for the pane's caption ("German", "us,de"). */
export function describeLayout(layouts: readonly XkbLayout[], list: string | undefined): string {
  const ids = (list || "us")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.map((id) => layouts.find((layout) => layout.id === id)?.name ?? id).join(", ");
}

/**
 * The layout's one name, as the row, the picker and its search say it: the
 * variant's own name when one is chosen ("English (US, euro on 5)"), else
 * the layout's ("English (US)"); several set by hand are listed.
 */
export function layoutName(xkb: XkbLayouts, list: string | undefined, variant: string | undefined): string {
  const layout = primaryLayout(list);
  const chosen = variant ? xkb.variants.find((each) => each.layout === layout && each.id === variant) : undefined;
  if ((list ?? "").includes(",") || !chosen) return describeLayout(xkb.layouts, list);
  return chosen.name;
}
