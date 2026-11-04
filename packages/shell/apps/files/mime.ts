/**
 * What a file is, by its name, the way the shared MIME database says
 * (`globs2`, written by shared-mime-info), and what to call that kind
 * ("PNG image", read from the database's own descriptions). Names only: no
 * file is opened to sniff it, so a folder of thousands lists at once.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface MimeIndex {
  /** `png`, `tar.gz` (lowercase) to type, for `*.ext` patterns. */
  extensions: Map<string, string>;
  /** Whole names (`Makefile`) to type. */
  literals: Map<string, string>;
}

/** `weight:type:glob[:flags]` lines; the heaviest pattern for a glob wins, case-insensitively unless it says `cs`. */
export function parseGlobs2(text: string): MimeIndex {
  const extensions = new Map<string, { type: string; weight: number }>();
  const literals = new Map<string, { type: string; weight: number }>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [weightText, type, glob, flags] = line.split(":");
    if (!type || !glob) continue;
    const weight = Number(weightText) || 0;
    const caseSensitive = flags?.split(",").includes("cs") === true;
    const put = (map: Map<string, { type: string; weight: number }>, key: string): void => {
      const name = caseSensitive ? key : key.toLowerCase();
      const known = map.get(name);
      if (!known || weight > known.weight) map.set(name, { type, weight });
    };
    if (glob.startsWith("*.") && !/[*?[\]]/.test(glob.slice(2))) put(extensions, glob.slice(2));
    else if (!/[*?[\]]/.test(glob)) put(literals, glob);
  }
  const flat = (map: Map<string, { type: string }>): Map<string, string> => new Map([...map].map(([key, value]) => [key, value.type]));
  return { extensions: flat(extensions), literals: flat(literals) };
}

export const INODE_DIRECTORY = "inode/directory";
export const UNKNOWN_TYPE = "application/octet-stream";

/** The type of a file called `name`: whole name first, then the longest extension (`tar.gz` before `gz`). */
export function mimeOf(index: MimeIndex, name: string): string {
  const literal = index.literals.get(name) ?? index.literals.get(name.toLowerCase());
  if (literal) return literal;
  const lower = name.toLowerCase();
  for (let dot = lower.indexOf("."); dot >= 0; dot = lower.indexOf(".", dot + 1)) {
    if (dot === 0 && lower.indexOf(".", 1) < 0) continue;
    const type = index.extensions.get(lower.slice(dot + 1));
    if (type) return type;
  }
  return lower.endsWith(".txt") ? "text/plain" : UNKNOWN_TYPE;
}

function dataDirs(env: Record<string, string | undefined>, home: string): string[] {
  return [env.XDG_DATA_HOME || join(home, ".local/share"), ...(env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean)];
}

let loaded: MimeIndex | null = null;

/** The system's MIME index, read once; empty when the database is not installed. */
export function systemMimeIndex(env: Record<string, string | undefined> = process.env, home: string = homedir()): MimeIndex {
  if (loaded) return loaded;
  const merged: MimeIndex = { extensions: new Map(), literals: new Map() };
  // Nearer directories win, so they are applied last.
  for (const dir of dataDirs(env, home).reverse()) {
    try {
      const index = parseGlobs2(readFileSync(join(dir, "mime/globs2"), "utf8"));
      for (const [key, value] of index.extensions) merged.extensions.set(key, value);
      for (const [key, value] of index.literals) merged.literals.set(key, value);
    } catch {
      // No database here.
    }
  }
  loaded = merged;
  return merged;
}

/** The untranslated `<comment>` of a `mime/<type>.xml` file ("PNG image"). */
export function parseComment(xml: string): string | null {
  const match = /<comment>([^<]*)<\/comment>/.exec(xml);
  return match?.[1]?.trim() || null;
}

const GENERIC: Record<string, string> = {
  image: "Image",
  audio: "Audio",
  video: "Video",
  text: "Text document",
  font: "Font",
  model: "3D model",
};

const kinds = new Map<string, string>();

/** A human name for a type: the database's description, else its category, else the type. */
export function kindOf(type: string, env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  if (type === INODE_DIRECTORY) return "Folder";
  const known = kinds.get(type);
  if (known) return known;
  let label: string | null = null;
  // The type came from a database file, but a path is built from it: only plain type names are looked up.
  if (/^[a-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(type)) {
    for (const dir of dataDirs(env, home)) {
      try {
        label = parseComment(readFileSync(join(dir, "mime", `${type}.xml`), "utf8"));
        if (label) break;
      } catch {
        // Not in this directory.
      }
    }
  }
  label ??= GENERIC[type.split("/")[0] ?? ""] ?? (type === UNKNOWN_TYPE ? "Document" : type);
  kinds.set(type, label);
  return label;
}

/** Icon names to try for a type, most specific first (`image/png`: `image-png`, `image-x-generic`). */
export function iconNames(type: string): string[] {
  if (type === INODE_DIRECTORY) return ["folder"];
  const [category = ""] = type.split("/");
  return [type.replace("/", "-"), `${category}-x-generic`, "text-x-generic"];
}

/** A coarse category for choosing a bundled fallback icon. */
export type Category = "folder" | "image" | "audio" | "video" | "archive" | "code" | "text" | "document" | "other";

const ARCHIVES = /(zip|tar|gzip|x-7z|x-rar|compress|x-xz|x-bzip|zstd|x-cpio|x-iso|x-raw-disk|x-lzma)/;
const DOCUMENTS = /(pdf|msword|officedocument|opendocument|rtf|epub|postscript|x-abiword|vnd\.ms-)/;
const CODE =
  /(javascript|json|typescript|xml|x-shellscript|x-python|x-csrc|x-chdr|x-c\+\+|x-rust|x-java|x-php|x-ruby|yaml|toml|x-sql|x-perl|html|css|x-desktop|x-meson|markdown|x-go)/;

export function categoryOf(type: string): Category {
  if (type === INODE_DIRECTORY) return "folder";
  const [kind = "", subtype = ""] = type.split("/");
  if (kind === "image") return "image";
  if (kind === "audio") return "audio";
  if (kind === "video") return "video";
  if (ARCHIVES.test(subtype)) return "archive";
  if (DOCUMENTS.test(subtype)) return "document";
  if (kind === "text" && CODE.test(subtype)) return "code";
  if (kind === "application" && CODE.test(subtype)) return "code";
  if (kind === "text") return "text";
  return "other";
}
