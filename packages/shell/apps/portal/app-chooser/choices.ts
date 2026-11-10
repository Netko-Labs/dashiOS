/**
 * Open With, decided: which apps the short list shows and in what order,
 * and what "Always" writes. The default for the type comes first (what
 * `gio mime` names, which reads the mimeapps.list files, Dashi's system one
 * from default-handlers.ts among them), then the app chosen last time, then
 * the others xdg-desktop-portal offers; the short list stops at four, and
 * "Other…" shows the rest. "Always use" puts the app first for the type in
 * the person's own `~/.config/mimeapps.list`, as Files' Open With does,
 * with the same merge the installer uses (src/shared/apps/default-handlers.ts).
 */

import { mergeDefaults } from "../../../src/shared/apps/default-handlers.ts";
import { cleanString, str, vardict } from "../vardict.ts";

export const SHORT_LIST = 4;

export interface AppChooserRequest {
  appId: string;
  parent: string;
  /** Desktop ids without `.desktop`, as the portal gives them. */
  choices: string[];
  lastChoice: string | null;
  contentType: string | null;
  /** What is being opened, for the sheet's title. */
  filename: string | null;
  uri: string | null;
  activationToken: string | null;
}

const DESKTOP_ID = /^[\w.+-]{1,255}$/;
const MIME = /^[\w.+-]+\/[\w.+-]+$/;

export function parseAppChooser(args: readonly unknown[]): AppChooserRequest {
  const [appId, parent, choices, options] = args;
  const dict = vardict(options);
  const ids = Array.isArray(choices) ? [...new Set(choices.filter((id): id is string => typeof id === "string" && DESKTOP_ID.test(id)))].slice(0, 200) : [];
  const contentType = str(dict, "content_type")?.toLowerCase() ?? null;
  const last = str(dict, "last_choice") ?? null;
  return {
    appId: typeof appId === "string" ? cleanString(appId, 256) : "",
    parent: typeof parent === "string" ? cleanString(parent, 256) : "",
    choices: ids,
    lastChoice: last && DESKTOP_ID.test(last) ? last : null,
    contentType: contentType && MIME.test(contentType) ? contentType : null,
    filename: str(dict, "filename") ?? null,
    uri: str(dict, "uri") ?? null,
    activationToken: str(dict, "activation_token") ?? null,
  };
}

/** The desktop id (no `.desktop`) `gio mime TYPE` names as the default, or null. */
export function parseGioDefault(output: string): string | null {
  const match = /^Default application for .*?: ([\w.+-]+)\.desktop\s*$/m.exec(output);
  return match ? (match[1] as string) : null;
}

/** The order the list shows: the default, the last choice, then the rest as offered; each once, only ones offered. */
export function orderChoices(request: Pick<AppChooserRequest, "choices" | "lastChoice">, defaultId: string | null): string[] {
  const offered = new Set(request.choices);
  const first = [defaultId, request.lastChoice].filter((id): id is string => id !== null && offered.has(id));
  return [...new Set([...first, ...request.choices])];
}

/** `mimeapps.list` text with `id` the default for `mime` (the person's file; nothing else changes). */
export function alwaysUse(text: string, mime: string, id: string): string {
  return mergeDefaults(text, { [mime]: `${id}.desktop` });
}

/** A name for what is being opened: the file's name, a link's address, else the kind. */
export function subjectOf(request: Pick<AppChooserRequest, "filename" | "uri" | "contentType">): string {
  if (request.filename) return request.filename.split("/").pop() || request.filename;
  if (request.uri) {
    try {
      const url = new URL(request.uri);
      return url.protocol === "file:" ? decodeURIComponent(url.pathname.split("/").pop() ?? "") || request.uri : url.host || request.uri;
    } catch {
      return request.uri;
    }
  }
  return request.contentType ?? "this";
}
