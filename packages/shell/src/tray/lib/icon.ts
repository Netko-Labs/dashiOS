/**
 * A tray item's icon as a file the bar draws. An icon name is looked up in
 * the item's own IconThemePath first, then hicolor and the installed themes
 * (shared/apps/icons.ts) at the sizes and categories tray icons come in; an absolute
 * path is used as it is. Without a name that resolves, the item's pixmap is
 * written as a PNG under `$XDG_RUNTIME_DIR/dashi-tray`, named by its content
 * so the same picture is written once and a changed one gets a new path.
 * Files are counted by the items that show them and removed with the last.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtraIcon } from "../../extras/index.ts";
import { dataDirs, themeIcon } from "../../shared/apps/index.ts";
import { argbToRgba, encodePng, type Pixmap, PREFERRED_SIDE, pickPixmap } from "./png.ts";
import type { IconSource } from "./props.ts";

/** Where tray icons live in a theme: status icons first, then app icons. */
const CATEGORIES = ["status", "apps", "panel", "devices", "notifications"];

/** hicolor sizes, nearest the bar's first. */
const HICOLOR_SIZES = ["scalable", "32x32", "48x48", "24x24", "22x22", "64x64", "16x16", "128x128", "256x256"];

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** `name` (a theme icon name, not a path) in `<root>/hicolor`, or null. */
function hicolorIcon(name: string, root: string): string | null {
  for (const size of HICOLOR_SIZES) {
    for (const category of CATEGORIES) {
      for (const ext of size === "scalable" ? ["svg"] : ["png", "svg"]) {
        const path = join(root, "hicolor", size, category, `${name}.${ext}`);
        if (existsSync(path)) return path;
      }
    }
  }
  return null;
}

/** The file for an icon name, or null if no theme or the item's own directory has it. */
export function iconFile(name: string, themePath: string, roots: readonly string[]): string | null {
  if (!name) return null;
  if (name.startsWith("/")) return isFile(name) ? name : null;
  // Theme names never hold a path; one that climbs out is not an icon name.
  if (name.includes("/") || name.startsWith(".")) return null;
  const own = themePath && isAbsolute(themePath) ? [themePath] : [];
  for (const dir of own) {
    for (const ext of ["png", "svg"]) {
      const path = join(dir, `${name}.${ext}`);
      if (isFile(path)) return path;
    }
  }
  for (const root of [...own, ...roots]) {
    const found = hicolorIcon(name, root);
    if (found) return found;
  }
  const themed = themeIcon(name, [...own, ...roots], CATEGORIES);
  if (themed) return themed;
  for (const ext of ["png", "svg"]) {
    const path = `/usr/share/pixmaps/${name}.${ext}`;
    if (isFile(path)) return path;
  }
  return null;
}

/** Bytes of a symbolic SVG read to draw as a glyph; anything larger is not one. */
const MAX_SYMBOLIC = 64 * 1024;

const themesUnder = (root: string): string[] => {
  try {
    return readdirSync(root).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
};

/**
 * The symbolic SVG for an icon name (`<name>-symbolic`, or the name itself
 * when it is one), in the item's own directory or any theme's `symbolic`,
 * `scalable`, or 16 px folders: a monochrome template, drawn in the bar's ink
 * like Dashi's own glyphs. Null if no theme has one.
 */
export function symbolicFile(name: string, themePath: string, roots: readonly string[]): string | null {
  if (!name || name.includes("/") || name.startsWith(".")) return null;
  const wanted = name.endsWith("-symbolic") ? name : `${name}-symbolic`;
  if (themePath && isAbsolute(themePath) && isFile(join(themePath, `${wanted}.svg`))) return join(themePath, `${wanted}.svg`);
  for (const root of roots) {
    for (const theme of themesUnder(root)) {
      for (const size of ["symbolic", "scalable", "16x16"]) {
        for (const category of CATEGORIES) {
          const path = join(root, theme, size, category, `${wanted}.svg`);
          if (isFile(path)) return path;
        }
      }
    }
  }
  return null;
}

/** A full-color icon at a tray's small sizes (and in `legacy`, where Adwaita keeps them now), or null. */
export function smallThemedFile(name: string, roots: readonly string[]): string | null {
  if (!name || name.includes("/") || name.startsWith(".")) return null;
  for (const root of roots) {
    for (const theme of themesUnder(root)) {
      for (const size of ["32x32", "24x24", "22x22", "48x48", "16x16"]) {
        for (const category of [...CATEGORIES, "legacy"]) {
          for (const ext of ["png", "svg"]) {
            const path = join(root, theme, size, category, `${name}.${ext}`);
            if (isFile(path)) return path;
          }
        }
      }
    }
  }
  return null;
}

/** A symbolic SVG as glyph markup, or null when it can't be read or is too large to be one. */
function glyphMarkup(path: string): string | null {
  try {
    if (statSync(path).size > MAX_SYMBOLIC) return null;
    const text = readFileSync(path, "utf8");
    const start = text.indexOf("<svg");
    return start >= 0 ? text.slice(start).trim() : null;
  } catch {
    return null;
  }
}

/** PNG files written for pixmaps, counted by the items that show them. */
export class PixmapFiles {
  private readonly uses = new Map<string, number>();

  constructor(private readonly dir: string) {}

  /** The file for `pixmap`, written now if no other item shows the same picture; null if it can't be written. */
  acquire(pixmap: Pixmap): string | null {
    const hash = Bun.hash(pixmap.data).toString(16);
    const path = join(this.dir, `${pixmap.width}x${pixmap.height}-${hash}.png`);
    if (!this.uses.has(path) && !existsSync(path)) {
      try {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        // Written aside and renamed, so the renderer never reads half a file.
        const partial = `${path}.${process.pid}.part`;
        writeFileSync(partial, encodePng(pixmap.width, pixmap.height, argbToRgba(pixmap.data)), { mode: 0o600 });
        renameSync(partial, path);
      } catch (error) {
        console.error(`dashi-shell: tray: could not write an icon to ${this.dir}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }
    this.uses.set(path, (this.uses.get(path) ?? 0) + 1);
    return path;
  }

  /** An item stopped showing `path`; the last one removes the file. Paths this did not write are ignored. */
  release(path: string): void {
    const count = this.uses.get(path);
    if (count === undefined) return;
    if (count > 1) {
      this.uses.set(path, count - 1);
      return;
    }
    this.uses.delete(path);
    try {
      unlinkSync(path);
    } catch {
      // Already gone.
    }
  }

  /** Remove every file still shown (the tray is going away). */
  clear(): void {
    for (const path of [...this.uses.keys()]) {
      this.uses.set(path, 1);
      this.release(path);
    }
  }
}

export interface TrayIconOptions {
  /** Icon theme roots (`…/share/icons`); the XDG data directories' by default. */
  roots?: readonly string[];
  /** Where pixmaps are written; `$XDG_RUNTIME_DIR/dashi-tray` by default, null for no pixmaps. */
  cacheDir?: string | null;
  /** The pixmap size wanted, in pixels. */
  side?: number;
}

/** Icon names and pixmaps to files, for every item of one tray. */
export class TrayIcons {
  private readonly roots: readonly string[];
  private readonly files: PixmapFiles | null;
  private readonly side: number;

  constructor(options: TrayIconOptions = {}) {
    this.roots = options.roots ?? dataDirs().map((dir) => join(dir, "icons"));
    const runtime = process.env.XDG_RUNTIME_DIR;
    const dir = options.cacheDir === undefined ? (runtime && isAbsolute(runtime) ? join(runtime, "dashi-tray") : null) : options.cacheDir;
    this.files = dir ? new PixmapFiles(dir) : null;
    this.side = options.side ?? PREFERRED_SIDE;
  }

  /** The icon for `source`; a pixmap file it returns is held until `release`. */
  resolve(source: IconSource): ExtraIcon | null {
    // A name asked for as symbolic is a template: drawn in the bar's ink.
    if (source.name.endsWith("-symbolic")) {
      const glyph = this.symbolic(source);
      if (glyph) return glyph;
    }
    const named = iconFile(source.name, source.themePath, this.roots);
    if (named) return { kind: "image", path: named };
    // Themes like Adwaita now ship many status icons only as symbolic ones.
    const glyph = this.symbolic(source) ?? null;
    if (glyph) return glyph;
    const small = smallThemedFile(source.name, this.roots);
    if (small) return { kind: "image", path: small };
    const pixmap = pickPixmap(source.pixmaps, this.side);
    const path = pixmap && this.files ? this.files.acquire(pixmap) : null;
    return path ? { kind: "image", path } : null;
  }

  private symbolic(source: IconSource): ExtraIcon | null {
    const file = symbolicFile(source.name, source.themePath, this.roots);
    const markup = file ? glyphMarkup(file) : null;
    return markup ? { kind: "glyph", markup } : null;
  }

  /** An icon `resolve` gave is no longer shown. */
  release(icon: ExtraIcon | null): void {
    if (icon?.kind === "image") this.files?.release(icon.path);
  }

  close(): void {
    this.files?.clear();
  }
}
