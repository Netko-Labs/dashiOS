/**
 * Which files a filter lets through, and the names a save may use. Globs
 * match the file's name, case aside (`*.pdf` takes `Lease.PDF`), the way
 * people expect it more than GTK 3's case-sensitive patterns did. MIME
 * patterns match the type the shared MIME database gives the name (Files'
 * mime.ts): exactly, or a whole family with `image/*`. Folders always show,
 * so there is a way through to the files.
 */

import type { Filter } from "./request.ts";

const cache = new Map<string, RegExp>();

/** A shell glob as a regular expression over a whole name: `*`, `?`, and `[…]` classes. */
export function globRegex(glob: string): RegExp {
  const known = cache.get(glob);
  if (known) return known;
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string;
    if (char === "*") source += ".*";
    else if (char === "?") source += ".";
    else if (char === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end < 0) {
        source += "\\[";
        continue;
      }
      const body = glob.slice(i + 1, end).replace(/\\/g, "\\\\");
      source += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
      i = end;
    } else source += char.replace(/[.+^${}()|\\/]/g, "\\$&");
  }
  const regex = new RegExp(`^${source}$`, "is");
  if (cache.size > 256) cache.clear();
  cache.set(glob, regex);
  return regex;
}

export function mimeMatches(pattern: string, mime: string): boolean {
  const type = mime.toLowerCase();
  if (pattern === "*/*" || pattern === "*") return true;
  if (pattern.endsWith("/*")) return type.startsWith(pattern.slice(0, -1));
  return type === pattern;
}

/** Whether `filter` (none: everything) lets a file with this name and type through. */
export function passes(filter: Filter | null, name: string, mime: string): boolean {
  if (!filter) return true;
  return filter.patterns.some((pattern) => (pattern.kind === "glob" ? globRegex(pattern.pattern).test(name) : mimeMatches(pattern.pattern, mime)));
}

/** Why a name can't be saved as, or null when it can. */
export function nameProblem(name: string): string | null {
  if (name.trim() === "") return "Type a name.";
  if (name.includes("/")) return "A name can’t contain “/”.";
  if (name === "." || name === "..") return "That name is taken by the system.";
  if (/[\u0000-\u001f]/.test(name)) return "A name can’t contain control characters.";
  if (new TextEncoder().encode(name).length > 255) return "That name is too long.";
  return null;
}

/** `name` with ` 2`, ` 3`, … before its extension until `taken` says no: for SaveFiles into a folder that has them. */
export function untakenName(name: string, taken: (name: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return name;
}

/**
 * The extension a filter's only glob gives (`*.png` → `.png`), for a save
 * whose name has none, as GTK adds it when the filter is changed. Null when
 * the filter has no single plain extension.
 */
export function filterExtension(filter: Filter | null): string | null {
  const globs = filter?.patterns.filter((pattern) => pattern.kind === "glob") ?? [];
  const match = globs.length === 1 ? /^\*(\.[A-Za-z0-9]{1,8})$/.exec(globs[0]?.pattern ?? "") : null;
  return match ? (match[1] as string) : null;
}

/** A save name with its extension swapped for the filter's (the person picked another type). */
export function withExtension(name: string, extension: string | null): string {
  if (!extension) return name;
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}${extension}`;
}
