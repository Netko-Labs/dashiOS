/**
 * The FileChooser calls, read and answered (org.freedesktop.impl.portal.
 * FileChooser): OpenFile, SaveFile and SaveFiles, each `(handle, app_id,
 * parent_window, title, options)`. Options: accept_label, modal, multiple,
 * directory, filters `a(sa(us))` (0 a glob, 1 a MIME type), current_filter
 * `(sa(us))`, choices `a(ssa(ss)s)` (no options: a check box, "true" or
 * "false"), current_folder, current_file and files as NUL-ended `ay` paths,
 * current_name. Results: uris, choices `a(ss)`, current_filter.
 */

import type { Choice, ChooserAnswer, ChooserMode, ChooserRequest, Filter } from "../../files/chooser/request.ts";
import { fileUri } from "../../files/uri.ts";
import { Response, type ResponseCode } from "../request.ts";
import { bool, bytePath, cleanString, results, str, type Vardict, vardict } from "../vardict.ts";

export type { Choice, ChooserAnswer, ChooserMode, ChooserRequest, Filter, PatternKind } from "../../files/chooser/request.ts";

const MAX_FILTERS = 64;
const MAX_PATTERNS = 64;
const MAX_CHOICES = 16;
const MAX_FILES = 1000;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, max = 512): string | null => (typeof value === "string" ? cleanString(value, max) : null);

/** One `(sa(us))`, or null when it is not one (or has no usable pattern). */
export function parseFilter(value: unknown): Filter | null {
  const [name, patterns] = asArray(value);
  const label = text(name);
  if (label === null) return null;
  const parsed = asArray(patterns)
    .slice(0, MAX_PATTERNS)
    .flatMap((entry): Filter["patterns"] => {
      const [kind, pattern] = asArray(entry);
      const body = text(pattern);
      if (body === null || body === "") return [];
      if (kind === 0) return [{ kind: "glob", pattern: body }];
      if (kind === 1 && /^[\w.+-]+\/[\w.+*-]+$/.test(body)) return [{ kind: "mime", pattern: body.toLowerCase() }];
      return [];
    });
  return parsed.length > 0 ? { name: label || "Files", patterns: parsed } : null;
}

export function parseFilters(dict: Vardict): Filter[] {
  const entry = dict.get("filters");
  if (entry?.signature !== "a(sa(us))") return [];
  return asArray(entry.value)
    .slice(0, MAX_FILTERS)
    .flatMap((filter) => parseFilter(filter) ?? []);
}

export function parseChoices(dict: Vardict): Choice[] {
  const entry = dict.get("choices");
  if (entry?.signature !== "a(ssa(ss)s)") return [];
  return asArray(entry.value)
    .slice(0, MAX_CHOICES)
    .flatMap((choice): Choice[] => {
      const [id, label, options, initial] = asArray(choice);
      const key = text(id, 128);
      if (!key) return [];
      const parsed = asArray(options).flatMap((option) => {
        const [optionId, optionLabel] = asArray(option);
        const value = text(optionId, 128);
        return value ? [{ id: value, label: text(optionLabel) || value }] : [];
      });
      const start = text(initial, 128) ?? "";
      const valid = parsed.length === 0 ? (start === "true" ? "true" : "false") : parsed.some((o) => o.id === start) ? start : (parsed[0]?.id ?? "");
      return [{ id: key, label: text(label) || key, options: parsed, initial: valid }];
    });
}

const sameFilter = (a: Filter, b: Filter): boolean => a.name === b.name && JSON.stringify(a.patterns) === JSON.stringify(b.patterns);

/** The request a FileChooser call makes; `args` are the call's five arguments after the handle. */
export function parseChooser(mode: ChooserMode, args: readonly unknown[]): ChooserRequest {
  const [appId, parent, title, options] = args;
  const dict = vardict(options);
  const filters = parseFilters(dict);
  const current = dict.get("current_filter")?.signature === "(sa(us))" ? parseFilter(dict.get("current_filter")?.value) : null;
  // A current filter that is one of the list is that one; one given alone joins the list (as GTK does).
  const currentFilter = current ? (filters.find((filter) => sameFilter(filter, current)) ?? current) : (filters[0] ?? null);
  if (current && !filters.some((filter) => sameFilter(filter, current))) filters.unshift(current);
  const filesEntry = dict.get("files");
  const files =
    mode === "save-files" && filesEntry?.signature === "aay"
      ? asArray(filesEntry.value)
          .slice(0, MAX_FILES)
          .flatMap((bytes) => {
            if (!(bytes instanceof Uint8Array)) return [];
            const end = bytes.indexOf(0);
            const name = new TextDecoder().decode(end >= 0 ? bytes.subarray(0, end) : bytes);
            // Names, and the last part of a path if one was given; nothing that climbs out of the folder.
            const base = name.split("/").pop() ?? "";
            return base && base !== "." && base !== ".." && !/[\u0000-\u001f]/.test(base) ? [base] : [];
          })
      : [];
  const currentName = mode === "save" ? (str(dict, "current_name") ?? null) : null;
  return {
    mode,
    appId: text(appId, 256) ?? "",
    parent: text(parent, 256) ?? "",
    title: text(title) || (mode === "open" ? "Open" : "Save"),
    acceptLabel: str(dict, "accept_label")?.replace(/_/g, "") || null,
    multiple: mode === "open" && bool(dict, "multiple") === true,
    directory: mode === "open" && bool(dict, "directory") === true,
    filters,
    currentFilter,
    choices: parseChoices(dict),
    currentFolder: bytePath(dict, "current_folder") ?? null,
    currentName: currentName && !currentName.includes("/") ? currentName : null,
    currentFile: mode === "save" ? (bytePath(dict, "current_file") ?? null) : null,
    files,
  };
}

/** A filter back as the `(sa(us))` the portal reads. */
export function filterValue(filter: Filter): [string, Array<[number, string]>] {
  return [filter.name, filter.patterns.map((pattern) => [pattern.kind === "glob" ? 0 : 1, pattern.pattern])];
}

/** The reply to a FileChooser call: the response code and its results. */
export function chooserReply(answer: ChooserAnswer | null): [ResponseCode, Map<string, unknown>] {
  if (!answer || answer.paths.length === 0) return [Response.cancelled, new Map()];
  return [
    Response.success,
    results({
      uris: ["as", answer.paths.map(fileUri)],
      choices: answer.choices.length > 0 ? ["a(ss)", answer.choices] : undefined,
      current_filter: answer.filter ? ["(sa(us))", filterValue(answer.filter)] : undefined,
    }),
  ];
}
