/**
 * `--file-selection`, Zenity's most used dialog, on Files' chooser
 * (apps/files/chooser/): `--save`, `--directory`, `--multiple`,
 * `--filename` (a folder ending in "/" to start in, or a file: its folder,
 * and its name to save as), `--file-filter` ("Pictures | *.png *.jpg", or
 * just the patterns; several make a menu), `--separator` between the paths
 * printed. A save onto a taken name always asks (`--confirm-overwrite` is
 * how Dashi saves anyway).
 */

import { isAbsolute, join } from "node:path";
import { type ChooserRequest, chooserRequest, type Filter } from "../files/chooser/request.ts";

export interface FileSelectionOptions {
  filename: string | null;
  multiple: boolean;
  directory: boolean;
  save: boolean;
  separator: string;
  filters: Filter[];
}

/** One `--file-filter`: "NAME | PATTERN …" or just "PATTERN …" (named by its patterns); null when it has none. */
export function parseFileFilter(raw: string): Filter | null {
  const bar = raw.indexOf("|");
  const name = bar >= 0 ? raw.slice(0, bar).trim() : "";
  const patterns = (bar >= 0 ? raw.slice(bar + 1) : raw)
    .split(/\s+/)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== "");
  if (patterns.length === 0) return null;
  return { name: name || patterns.join(" "), patterns: patterns.map((pattern) => ({ kind: "glob", pattern })) };
}

/** The chooser request for these options; `cwd` resolves a relative `--filename`. */
export function selectionRequest(title: string, options: FileSelectionOptions, cwd: string): ChooserRequest {
  const given = options.filename === null ? null : isAbsolute(options.filename) ? options.filename : join(cwd, options.filename);
  const folderOnly = given !== null && (options.filename?.endsWith("/") ?? false);
  const folder = given === null ? null : folderOnly ? given.replace(/\/+$/, "") || "/" : given.slice(0, given.lastIndexOf("/")) || "/";
  const name = given !== null && !folderOnly ? (given.split("/").pop() ?? null) : null;
  return chooserRequest(options.save ? "save" : "open", {
    appId: "dev.dashi.dialog",
    title,
    multiple: !options.save && options.multiple,
    directory: !options.save && options.directory,
    filters: options.filters,
    currentFilter: options.filters[0] ?? null,
    currentFolder: folder,
    currentName: options.save ? name : null,
  });
}

/** What goes to stdout: the paths, joined by the separator, and a newline. */
export function selectionOutput(paths: readonly string[], separator: string): string {
  return `${paths.join(separator)}\n`;
}
