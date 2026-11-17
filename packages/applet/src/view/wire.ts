/**
 * Version 6 of the applets channel: views the launcher draws from a tree
 * (docs/applets.md, "Version 6"; docs/launcher-extensions.md). After `open`
 * for a command whose mode is `list`, `grid` or `detail`:
 *
 *   shell → ext  {"type":"open","seq":12,"command":"my-prs","args":{},"query":"","preferences":{…}}
 *   ext → shell  {"type":"tree","seq":12,"root":{…}}                      the view, whole
 *                {"type":"patch","seq":12,"ops":[{"op":"replace","path":[0,2],"node":{…}}]}
 *                {"type":"push","seq":12,"root":{…}}  {"type":"pop","seq":12}   a view over it, and back
 *                {"type":"toast","seq":12,"style":"done","title":"Copied"}      one line in the field row
 *                {"type":"close","seq":12}                                       done: the launcher closes
 *   shell → ext  {"type":"event","seq":12,"on":"action","node":"a19"}           an Action chosen (↩, its key, ❖K)
 *                {"type":"event","seq":12,"on":"search","text":"widg"}          the field, when the extension filters
 *                {"type":"event","seq":12,"on":"select","node":"i4"}            the selection moved
 *                {"type":"event","seq":12,"on":"more"}                          the end of a list that has more
 *                {"type":"event","seq":12,"on":"pop"}                           Esc on a pushed view: it went
 *                {"type":"event","seq":12,"on":"close"}                         the launcher left the view
 *                {"type":"event","seq":12,"on":"change","node":"f3","value":"Fix"}  a form's field changed
 *                {"type":"event","seq":12,"on":"submit","node":"a7","values":{…}}   a form sent (its fields checked)
 *                {"type":"prefs","seq":12,"preferences":{…}}                    the person changed one
 *                {"type":"accounts","seq":12,"accounts":{"github.com":{…}}}   one connected or disconnected
 *
 * `open`, `copy`, `paste`, `set` and `connect` actions run in the shell; the
 * extension hears `action` for them too, after they ran, and runs `push` and
 * `run` itself. A `submit` is heard as `submit`, with the form's values, once
 * the launcher found every field filled as it says.
 */

import { isRecord } from "@dashi/shape";
import { id, integer, isRefusal, type Refusal, record, refuse, text } from "@dashi/shape/kit";
import { parseTree, type ViewNode } from "./tree.ts";

export const VIEW_PROTOCOL = 6;

/** A run's number, as version 3's (protocol-types.ts `MAX_SEQ`). */
const MAX_SEQ = 2 ** 31;

export const TOAST_STYLES = ["done", "failed", "working"] as const;
export type ToastStyle = (typeof TOAST_STYLES)[number];

/** A preference's value as the extension reads it: words, or a switch. */
export type PreferenceValue = string | boolean;

/** A form field's value: words (a text, a choice), a switch, or tags. */
export type FieldValue = string | boolean | readonly string[];

/** A connected account as the extension gets it (accounts.ts): who, and the token to send its provider. */
export interface AccountGiven {
  login: string;
  token: string;
}

export type ViewMessage =
  | { type: "tree"; seq: number; root: ViewNode }
  /** Checked by the shell against the tree it holds (tree.ts `applyPatch`). */
  | { type: "patch"; seq: number; ops: unknown[] }
  | { type: "push"; seq: number; root: ViewNode }
  | { type: "pop"; seq: number }
  | { type: "toast"; seq: number; style: ToastStyle; title: string }
  | { type: "close"; seq: number };

export const EVENTS = ["action", "search", "select", "more", "pop", "close", "change", "submit"] as const;
export type ViewEventName = (typeof EVENTS)[number];

export type ViewEvent =
  | { on: "action" | "select"; node: string }
  | { on: "search"; text: string }
  | { on: "more" | "pop" | "close" }
  | { on: "change"; node: string; value: FieldValue }
  | { on: "submit"; node: string; values: Record<string, FieldValue> };

export type ViewShellMessage =
  | {
      type: "open";
      seq: number;
      command: string;
      args: Record<string, string | number | boolean>;
      query: string;
      preferences: Record<string, PreferenceValue>;
      /** Its accounts that are connected, by provider. */
      accounts: Record<string, AccountGiven>;
    }
  | ({ type: "event"; seq: number } & ViewEvent)
  | { type: "prefs"; seq: number; preferences: Record<string, PreferenceValue> }
  | { type: "accounts"; seq: number; accounts: Record<string, AccountGiven> };

export const VIEW_TYPES = ["tree", "patch", "push", "pop", "toast", "close"] as const;
export const isViewType = (type: string): type is ViewMessage["type"] => (VIEW_TYPES as readonly string[]).includes(type);

const FIELDS: Record<ViewMessage["type"], readonly string[]> = {
  tree: ["type", "seq", "root"],
  patch: ["type", "seq", "ops"],
  push: ["type", "seq", "root"],
  pop: ["type", "seq"],
  toast: ["type", "seq", "style", "title"],
  close: ["type", "seq"],
};

/** One of version 6's messages from an extension. */
export function parseViewMessage(type: ViewMessage["type"], raw: Record<string, unknown>): ViewMessage | Refusal {
  const fields = record(raw, type, FIELDS[type]);
  if (isRefusal(fields)) return fields;
  const seq = integer(fields.seq, `${type}: seq`, 1, MAX_SEQ);
  if (isRefusal(seq)) return seq;
  switch (type) {
    case "tree":
    case "push": {
      const root = parseTree(fields.root);
      return isRefusal(root) ? refuse(`${type}: ${root.error}`) : { type, seq, root };
    }
    case "patch":
      return Array.isArray(fields.ops) && fields.ops.length <= 500 ? { type, seq, ops: fields.ops } : refuse("patch: ops must be a list of at most 500");
    case "toast": {
      const style = fields.style ?? "done";
      if (typeof style !== "string" || !(TOAST_STYLES as readonly string[]).includes(style)) return refuse(`toast: style must be ${TOAST_STYLES.join(", ")}`);
      const title = text(fields.title, "toast: title", 80);
      if (isRefusal(title)) return title;
      return { type, seq, style: style === "failed" ? "failed" : style === "working" ? "working" : "done", title };
    }
    case "pop":
    case "close":
      return { type, seq };
  }
}

const isArgValue = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

function preferencesOf(value: unknown): Record<string, PreferenceValue> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, PreferenceValue> = {};
  for (const [name, each] of Object.entries(value)) {
    if (typeof each !== "string" && typeof each !== "boolean") return null;
    out[name] = each;
  }
  return out;
}

function accountsOf(value: unknown): Record<string, AccountGiven> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, AccountGiven> = {};
  for (const [provider, each] of Object.entries(value)) {
    if (!isRecord(each) || typeof each.login !== "string" || typeof each.token !== "string") return null;
    out[provider] = { login: each.login, token: each.token };
  }
  return out;
}

/** A field's value as the wire carries it; null for anything else. */
export function fieldValueOf(value: unknown): FieldValue | null {
  if (typeof value === "string") return value.slice(0, 8 * 1024);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value) && value.length <= 24 && value.every((each) => typeof each === "string")) return value.map((each) => String(each).slice(0, 120));
  return null;
}

function valuesOf(value: unknown): Record<string, FieldValue> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, FieldValue> = {};
  for (const [name, each] of Object.entries(value)) {
    const parsed = fieldValueOf(each);
    if (parsed === null) return null;
    out[name] = parsed;
  }
  return out;
}

const nodeOf = (value: unknown): string | null => (typeof value === "string" && !isRefusal(id(value, "node", 128)) ? value : null);

function parseEvent(fields: Record<string, unknown>, seq: number): ViewShellMessage | null {
  const on = fields.on;
  const node = nodeOf(fields.node);
  if ((on === "action" || on === "select") && node) return { type: "event", seq, on, node };
  if (on === "search" && typeof fields.text === "string") return { type: "event", seq, on, text: fields.text.slice(0, 500) };
  if (on === "more" || on === "pop" || on === "close") return { type: "event", seq, on };
  if (on === "change" && node) {
    const value = fieldValueOf(fields.value);
    return value === null ? null : { type: "event", seq, on, node, value };
  }
  if (on === "submit" && node) {
    const values = valuesOf(fields.values);
    return values ? { type: "event", seq, on, node, values } : null;
  }
  return null;
}

/** One of version 6's messages from the shell (the extension's side); null for anything else. */
export function parseViewShellMessage(type: string, fields: Record<string, unknown>, seq: number): ViewShellMessage | null {
  if (type === "open") {
    if (typeof fields.command !== "string") return null;
    const args: Record<string, string | number | boolean> = {};
    for (const [name, value] of Object.entries(isRecord(fields.args) ? fields.args : {})) if (isArgValue(value)) args[name] = value;
    const preferences = preferencesOf(fields.preferences ?? {});
    const accounts = accountsOf(fields.accounts ?? {});
    if (!preferences || !accounts) return null;
    return { type, seq, command: fields.command, args, query: typeof fields.query === "string" ? fields.query : "", preferences, accounts };
  }
  if (type === "prefs") {
    const preferences = preferencesOf(fields.preferences);
    return preferences ? { type, seq, preferences } : null;
  }
  if (type === "accounts") {
    const accounts = accountsOf(fields.accounts);
    return accounts ? { type, seq, accounts } : null;
  }
  return type === "event" ? parseEvent(fields, seq) : null;
}
