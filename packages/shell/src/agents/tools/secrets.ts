/**
 * Secrets for agents (docs/secrets.md): logins agents can use but never
 * read. list_logins names sites and accounts only; sign_in and fill_code ask
 * the person, then Dashi types the password or the one-time code into a
 * field it checked; hand_over gives a window to the person until they press
 * Done, blanked in the agent's pictures meanwhile.
 */

import { type Args, fail, type ToolDef, windowArg, windowProp } from "./define.ts";
import type { CallError } from "./types.ts";

/** A site as an agent may name it: a host, or an address whose host is taken. */
export function parseSite(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const trimmed = value.trim();
  let host = trimmed;
  try {
    host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
  host = host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  const labels = host.split(".");
  const valid = labels.length >= 2 && labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  return valid ? host : null;
}

function site(args: Args, required: boolean): string | null | CallError {
  if (args.site === undefined && !required) return null;
  return parseSite(args.site) ?? fail('`site` must be a site\'s host or address, like "github.com".');
}

function account(args: Args): string | null | CallError {
  if (args.account === undefined) return null;
  return typeof args.account === "string" && args.account.length > 0 && args.account.length <= 512
    ? args.account
    : fail("`account` must be an account name from list_logins.");
}

const siteProp = { type: "string", description: 'The site, as a host ("github.com") or the page\'s address.' };
const accountProp = { type: "string", description: "Which account, when list_logins shows more than one for the site." };
const submitProp = { type: "boolean", description: "Press Return after typing (default false)." };

export const secretTools: readonly ToolDef[] = [
  {
    name: "list_logins",
    title: "List saved logins",
    description:
      "The person's saved logins (from Dashi's vault and 1Password, where turned on): each one's site, account name, where it is saved, whether it has a one-time code, " +
      'and whether agents may use it ("ask") or not ("never"). Never a password or a code: sign_in and fill_code type those for you.',
    scope: "signin",
    readOnly: true,
    destructive: false,
    properties: { site: siteProp },
    parse: (args) => {
      const s = site(args, false);
      return typeof s === "object" && s !== null ? s : { name: "list_logins", site: s };
    },
  },
  {
    name: "sign_in",
    title: "Sign in for the person",
    description:
      "Sign in to a site in a browser window with one of the person's saved logins. Click into the page's user name or password field first. " +
      "The person is asked on screen which login, and whether for this once or the whole task; then Dashi types the account name (when the user name field is focused), " +
      "presses Tab, and types the password, only into a real password field on a page of that site. You never see the password, in results or screenshots (they show a blank). " +
      'A login marked "Never", a bank, or a CAPTCHA: use hand_over.',
    scope: "signin",
    readOnly: false,
    destructive: false,
    properties: { window: windowProp, site: siteProp, account: accountProp, submit: submitProp },
    required: ["window", "site"],
    parse: (args) => {
      const window = windowArg(args);
      if (typeof window !== "number") return window;
      const s = site(args, true);
      if (s === null || typeof s === "object") return s ?? fail("`site` is required.");
      const a = account(args);
      if (a !== null && typeof a === "object") return a;
      return { name: "sign_in", window, site: s, account: a, submit: args.submit === true };
    },
  },
  {
    name: "fill_code",
    title: "Enter a one-time code",
    description:
      "Enter the 6-digit two-factor code (TOTP) for a site into the focused field of a browser window, computed from the person's saved login; within the approval of sign_in when there was one. " +
      "You never see the code. Codes sent by email or text message are the person's: use hand_over.",
    scope: "signin",
    readOnly: false,
    destructive: false,
    properties: { window: windowProp, site: siteProp, account: accountProp, submit: submitProp },
    required: ["window", "site"],
    parse: (args) => {
      const window = windowArg(args);
      if (typeof window !== "number") return window;
      const s = site(args, true);
      if (s === null || typeof s === "object") return s ?? fail("`site` is required.");
      const a = account(args);
      if (a !== null && typeof a === "object") return a;
      return { name: "fill_code", window, site: s, account: a, submit: args.submit === true };
    },
  },
  {
    name: "hand_over",
    title: "Hand a window to the person",
    description:
      "Ask the person to do something themselves in a window (sign in to a bank, solve a CAPTCHA, enter a code from their phone): a banner says what's needed, " +
      "and you are paused until they press Done. The window is blank in your screenshots meanwhile. Say what they should do in `reason`, briefly.",
    scope: "act",
    readOnly: false,
    destructive: false,
    properties: { window: windowProp, reason: { type: "string", description: 'What the person should do, like "Sign in to your bank".' } },
    required: ["window", "reason"],
    parse: (args) => {
      const window = windowArg(args);
      if (typeof window !== "number") return window;
      if (typeof args.reason !== "string" || args.reason.trim() === "") return fail("`reason` is required: what the person should do.");
      // One line on the banner, without control characters.
      const reason = args.reason
        .replace(/\p{Cc}/gu, " ")
        .trim()
        .slice(0, 120);
      return { name: "hand_over", window, reason };
    },
  },
];
