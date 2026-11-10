/**
 * Which first-party app opens which MIME types by default, and how that
 * lands in the system `mimeapps.list` (`/etc/xdg/mimeapps.list`) when Dashi is
 * installed (scripts/install.sh, spin/build.sh). Only the system file is
 * ever written, never a person's own `~/.config/mimeapps.list`, so anything
 * they choose wins over it. Existing system entries are kept: Dashi's app is
 * put first in the list for its types, and what was there stays as the
 * fallback.
 */

import type { FirstPartySpec } from "./index.ts";

const GROUP = "[Default Applications]";

/** `{ "image/png": "dev.dashi.preview.desktop", … }` for the apps that ask to be the default. */
export function defaultHandlers(specs: readonly FirstPartySpec[]): Record<string, string> {
  const wanted: Record<string, string> = {};
  for (const spec of specs) {
    if (!spec.defaultHandler) continue;
    for (const mime of spec.mimeTypes ?? []) wanted[mime] ??= `${spec.id}.desktop`;
  }
  return wanted;
}

interface Located {
  lines: string[];
  /** Index of the group's header line, or -1. */
  start: number;
  /** Index after the group's last line. */
  end: number;
}

function locate(text: string): Located {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const start = lines.findIndex((line) => line.trim() === GROUP);
  if (start < 0) return { lines, start, end: lines.length };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if ((lines[i] as string).trim().startsWith("[")) {
      end = i;
      break;
    }
  }
  return { lines, start, end };
}

const listOf = (value: string): string[] =>
  value
    .split(";")
    .map((id) => id.trim())
    .filter(Boolean);
const join = (ids: readonly string[]): string => `${ids.join(";")};`;

/** `text` with each wanted handler first in its MIME type's default list; nothing else changes, and applying it twice is the same as once. */
export function mergeDefaults(text: string, wanted: Readonly<Record<string, string>>): string {
  let { lines, start, end } = locate(text);
  if (start < 0) {
    if (lines.length > 0 && (lines.at(-1) as string).trim() !== "") lines.push("");
    start = lines.length;
    lines.push(GROUP);
    end = lines.length;
  }
  for (const [mime, id] of Object.entries(wanted)) {
    let found = -1;
    for (let i = start + 1; i < end; i++) {
      if ((lines[i] as string).startsWith(`${mime}=`)) {
        found = i;
        break;
      }
    }
    if (found < 0) {
      // After the group's last line, not after the blank line that parts it from the next group.
      let at = end;
      while (at - 1 > start && (lines[at - 1] as string).trim() === "") at--;
      lines.splice(at, 0, `${mime}=${id};`);
      end++;
      continue;
    }
    const current = listOf((lines[found] as string).slice(mime.length + 1));
    if (current.includes(id)) continue;
    lines[found] = `${mime}=${join([id, ...current])}`;
  }
  return `${lines.join("\n")}\n`;
}

/** `text` without `ids` in the default lists (a line that empties goes): what uninstalling puts back. */
export function removeDefaults(text: string, ids: readonly string[]): string {
  const { lines, start, end } = locate(text);
  if (start < 0) return text;
  const kept: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (index <= start || index >= end) {
      kept.push(line);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0 || line.trim().startsWith("#")) {
      kept.push(line);
      continue;
    }
    const current = listOf(line.slice(eq + 1));
    const remaining = current.filter((id) => !ids.includes(id));
    if (remaining.length === current.length) kept.push(line);
    else if (remaining.length > 0) kept.push(`${line.slice(0, eq)}=${join(remaining)}`);
  }
  return kept.length === 0 ? "" : `${kept.join("\n")}\n`;
}
