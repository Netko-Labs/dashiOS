/**
 * What the extension says an action did (browser-extension/src/content/
 * changes.ts), what a page just opened looks like, and a sign-in's outcome
 * (page/outcome.ts), parsed: these come from a page's DOM, so every field is
 * checked and every text is bounded before an agent reads it.
 */

import { isRecord } from "@dashi/shape";

export interface PageChanges {
  changed: "near" | "elsewhere" | "none";
  still: boolean;
  now?: string;
  dialog?: string;
  appeared?: string;
  focus?: string;
}

export interface PageProbe {
  url: string;
  title: string;
  password: boolean;
  captcha: boolean;
}

export type SignInOutcome =
  | { kind: "signed-in"; how: string }
  | { kind: "wrong"; message: string }
  | { kind: "code"; how: string }
  | { kind: "captcha" }
  | { kind: "blocked"; message: string }
  | { kind: "loading" }
  | { kind: "unchanged"; message?: string };

const line = (value: unknown, max = 200): string | undefined =>
  typeof value === "string" && value.trim() !== ""
    ? value
        .replace(/[\p{Cc}\s]+/gu, " ")
        .trim()
        .slice(0, max)
    : undefined;

export function parseChanges(value: unknown): PageChanges | null {
  if (!isRecord(value)) return null;
  const changed = value.changed === "near" || value.changed === "elsewhere" ? value.changed : "none";
  const out: PageChanges = { changed, still: value.still !== false };
  for (const key of ["now", "dialog", "appeared", "focus"] as const) {
    const text = line(value[key]);
    if (text !== undefined) out[key] = text;
  }
  return out;
}

export function parseProbe(value: unknown): PageProbe | null {
  if (!isRecord(value)) return null;
  return { url: line(value.url, 2000) ?? "", title: line(value.title) ?? "", password: value.password === true, captcha: value.captcha === true };
}

export function parseOutcome(value: unknown): SignInOutcome | null {
  if (!isRecord(value)) return null;
  const message = line(value.message);
  switch (value.kind) {
    case "signed-in":
      return { kind: "signed-in", how: line(value.how) ?? "the form is gone" };
    case "code":
      return { kind: "code", how: line(value.how) ?? "the page asks for a code" };
    case "wrong":
    case "blocked":
      return { kind: value.kind, message: message ?? "" };
    case "captcha":
    case "loading":
      return { kind: value.kind };
    case "unchanged":
      return message ? { kind: "unchanged", message } : { kind: "unchanged" };
    default:
      return null;
  }
}
