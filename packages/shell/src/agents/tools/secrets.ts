/**
 * Secrets for agents (docs/secrets.md): logins agents can use but never
 * read. list_logins names sites and accounts only; sign_in and fill_code ask
 * the person, then Dashi types the password or the one-time code into a
 * field it checked; hand_over gives a window to the person until they press
 * Done, blanked in the agent's pictures meanwhile.
 */

import { optional } from "@dashi/shape";
import { parseAmount } from "../secrets/pay.ts";
import { custom, tool, windowIdArg } from "./args.ts";
import { refArg, tabArg } from "./browser.ts";
import { fail, type ToolDef } from "./define.ts";
import type { CallError, SecretTarget } from "./types.ts";

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

const SITE_SAYS = '`site` must be a site\'s host or address, like "github.com".';

/** The `site` argument: a host, or an address whose host is taken. */
const site = custom({ type: "string", description: 'The site, as a host ("github.com") or the page\'s address.' }, parseSite, SITE_SAYS);

const account = optional(
  custom(
    { type: "string", description: "Which account, when list_logins shows more than one for the site." },
    (value) => (typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null),
    "`account` must be an account name from list_logins.",
  ),
);

/** Press Return after typing: anything but `true` is false. */
const submit = optional(custom({ type: "boolean", description: "Press Return after typing (default false)." }, (value) => value === true, ""));

/** Where Dashi types: the field of a browser tab's element, or the focused field of a window. */
const field = {
  ref: optional(refArg("In the browser with Dashi's extension: the field's number from read_page (the user name, password, code or card number field).")),
  tab: tabArg('The tab of `ref` (default: the tab you used last), like "t12".'),
  window: optional(windowIdArg('Another app or browser: the window whose focused field Dashi fills, like "w3".')),
};

/** A window (its focused field), or a browser tab's element read_page numbered. */
function target({ ref, tab, window }: { ref?: number; tab?: number | null; window?: number }): SecretTarget | CallError {
  if (ref !== undefined) return window === undefined ? { ref, tab: tab ?? null } : fail("Give `ref` (an element of a browser tab) or `window`, not both.");
  if (tab !== undefined) return fail("`tab` goes with `ref`.");
  return window === undefined ? fail("`ref` (a password, code or card field read_page numbered) or `window` is required.") : { window };
}

const isTarget = (value: SecretTarget | CallError): value is SecretTarget => "window" in value || "ref" in value;

export const secretTools: readonly ToolDef[] = [
  tool({
    name: "list_logins",
    title: "List saved logins",
    description:
      "The person's saved logins (from Dashi's vault and 1Password, where turned on): each one's site, account name, where it is saved, whether it has a one-time code, " +
      'and whether agents may use it ("ask") or not ("never"). Never a password or a code: sign_in and fill_code type those for you.',
    scope: "signin",
    readOnly: true,
    destructive: false,
    args: { site: optional(site) },
    build: ({ site }) => ({ name: "list_logins", site: site ?? null }),
  }),
  tool({
    name: "sign_in",
    title: "Sign in for the person",
    description:
      "Sign in to a site with one of the person's saved logins. In the browser with Dashi's extension, name the user name or password field read_page numbered (`ref`); " +
      "elsewhere, click into the field first and name the window. " +
      "The person is asked on screen which login, and whether for this once or the whole task; then Dashi types the account name (when the user name field is focused), " +
      "presses Tab, and types the password, only into a real password field on a page of that site. You never see the password, in results or screenshots (they show a blank). " +
      'A login marked "Never", a bank, or a CAPTCHA: use hand_over.',
    scope: "signin",
    readOnly: false,
    destructive: false,
    args: { ...field, site, account, submit },
    build: (args) => {
      const where = target(args);
      return isTarget(where) ? { name: "sign_in", target: where, site: args.site, account: args.account ?? null, submit: args.submit === true } : where;
    },
  }),
  tool({
    name: "fill_code",
    title: "Enter a one-time code",
    description:
      "Enter the 6-digit two-factor code (TOTP) for a site into a code field (`ref` from read_page, or the focused field of a window), computed from the person's saved login; within the approval of sign_in when there was one. " +
      "You never see the code. Codes sent by email or text message are the person's: use hand_over.",
    scope: "signin",
    readOnly: false,
    destructive: false,
    args: { ...field, site, account, submit },
    build: (args) => {
      const where = target(args);
      return isTarget(where) ? { name: "fill_code", target: where, site: args.site, account: args.account ?? null, submit: args.submit === true } : where;
    },
  }),
  tool({
    name: "pay",
    title: "Pay for the person",
    description:
      "Pay on a checkout page with one of the person's saved cards (a single-use card first): name the card number field read_page numbered (`ref`), or click into it and name the window. " +
      "Within their limits per payment and per month, the person confirms the site and the amount with their fingerprint or password, every time; " +
      "then Dashi types the card number, expiry and security code into the fields that follow each other. You never see the card, and those fields are blank in your screenshots. " +
      "Then press the page's own pay button.",
    scope: "pay",
    readOnly: false,
    destructive: true,
    args: {
      ...field,
      site,
      amount: custom(
        { type: "string", description: 'The total the page shows, in dollars: "48.90".' },
        (value) => (typeof value === "string" ? parseAmount(value) : null),
        '`amount` must be the total in dollars, like "48.90".',
      ),
      card: optional(
        custom(
          { type: "string", description: "Which card, by its last four digits or its name in Settings (default: a single-use card)." },
          (value) => (typeof value === "string" && value.length <= 100 ? value : null),
          "`card` must be a card's last four digits or its name.",
        ),
      ),
    },
    build: (args) => {
      const where = target(args);
      return isTarget(where) ? { name: "pay", target: where, site: args.site, cents: args.amount, card: args.card ?? null } : where;
    },
  }),
  tool({
    name: "hand_over",
    title: "Hand a window to the person",
    description:
      "Ask the person to do something themselves in a window (sign in to a bank, solve a CAPTCHA, enter a code from their phone): a banner says what's needed, " +
      "and you are paused until they press Done. The window is blank in your screenshots meanwhile. Say what they should do in `reason`, briefly.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: {
      window: windowIdArg(),
      reason: custom(
        { type: "string", description: 'What the person should do, like "Sign in to your bank".' },
        // One line on the banner, without control characters.
        (value) =>
          typeof value === "string" && value.trim() !== ""
            ? value
                .replace(/\p{Cc}/gu, " ")
                .trim()
                .slice(0, 120)
            : null,
        "`reason` is required: what the person should do.",
      ),
    },
    build: ({ window, reason }) => ({ name: "hand_over", window, reason }),
  }),
];
