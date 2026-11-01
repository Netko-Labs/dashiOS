/**
 * What polkitd asks of an authentication agent, parsed. `BeginAuthentication`
 * arrives from the system bus, so every argument is checked before the rest of
 * the agent sees it, and text that ends up on screen is cleaned.
 */

import { DBusError, ERRORS, Variant } from "../dbus/index.ts";

/** The two error names polkitd understands from an agent. */
export const POLKIT_ERRORS = {
  /** The person dismissed the sheet, or polkitd cancelled the request. */
  cancelled: "org.freedesktop.PolicyKit1.Error.Cancelled",
  /** Authentication could not be completed. */
  failed: "org.freedesktop.PolicyKit1.Error.Failed",
} as const;

export interface AuthRequest {
  actionId: string;
  /** What the action wants to do, in the user's language ("Authentication is required to …"). */
  message: string;
  /** An icon name or path; often empty. */
  iconName: string;
  details: ReadonlyMap<string, string>;
  /** Names this request to the setuid helper and to `CancelAuthentication`. */
  cookie: string;
  /** The users who may authenticate (`unix-user` identities), in polkitd's order. */
  uids: readonly number[];
}

/** polkitd's cookies are hex and dashes; anything with whitespace or control characters is not one. */
const COOKIE = /^[\x21-\x7e]{1,255}$/;
/** What the sheet has room for (about eight lines); more is cut with an ellipsis. */
const MAX_MESSAGE = 250;
const MAX_ENTRIES = 64;
const MAX_IDENTITIES = 64;

const invalid = (text: string): DBusError => new DBusError(ERRORS.invalidArgs, text);

export const isCookie = (value: unknown): value is string => typeof value === "string" && COOKIE.test(value);

/** Text for the sheet: control characters become spaces, runs of space fold, and the length is bounded. */
export function plainText(text: string, limit = MAX_MESSAGE): string {
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function detailsOf(value: unknown): Map<string, string> {
  if (!(value instanceof Map)) throw invalid("details is not a dictionary");
  const details = new Map<string, string>();
  for (const [key, entry] of value) {
    if (typeof key !== "string" || typeof entry !== "string") throw invalid("details holds a non-string");
    if (details.size < MAX_ENTRIES) details.set(key, entry);
  }
  return details;
}

/** The uids among polkit identities `(sa{sv})`; groups and other kinds are polkitd's to expand, and are skipped. */
function uidsOf(value: unknown): number[] {
  if (!Array.isArray(value)) throw invalid("identities is not an array");
  const uids: number[] = [];
  for (const identity of value.slice(0, MAX_IDENTITIES)) {
    if (!Array.isArray(identity) || typeof identity[0] !== "string" || !(identity[1] instanceof Map)) {
      throw invalid("an identity is not (sa{sv})");
    }
    if (identity[0] !== "unix-user") continue;
    const uid = identity[1].get("uid");
    if (!(uid instanceof Variant) || uid.signature !== "u" || typeof uid.value !== "number") throw invalid("a unix-user has no uid");
    if (!uids.includes(uid.value)) uids.push(uid.value);
  }
  return uids;
}

/** The arguments of `BeginAuthentication(s s s a{ss} s a(sa{sv}))`; throws an `InvalidArgs` error for anything else. */
export function parseBegin(args: readonly unknown[]): AuthRequest {
  const [actionId, message, iconName, details, cookie, identities] = args;
  if (typeof actionId !== "string" || typeof message !== "string" || typeof iconName !== "string") {
    throw invalid("action_id, message, and icon_name must be strings");
  }
  if (!isCookie(cookie)) throw invalid("the cookie is not one polkit makes");
  return {
    actionId: plainText(actionId, 255),
    message: plainText(message),
    iconName: iconName.length <= 255 ? iconName : "",
    details: detailsOf(details),
    cookie,
    uids: uidsOf(identities),
  };
}

/** Whose password to ask for first: the person at the keyboard when polkitd allows them, else the first listed. */
export function orderUids(uids: readonly number[], me: number): number[] {
  return uids.includes(me) ? [me, ...uids.filter((uid) => uid !== me)] : [...uids];
}
