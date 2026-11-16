/**
 * What the website tools say happened, in words for a model that has never
 * seen Dashi: a page that loaded, else what changed on the page; where
 * open_url really landed (a redirect, a sign-in page); a sign-in's outcome.
 * Pure, so the sentences are tested.
 */

import type { PageProbe, SignInOutcome } from "../../../browser/index.ts";

const pathOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.host.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
};

const SIGN_IN_PATH = /(^|[/._-])(login|log-in|signin|sign-in|sign_in|auth|accounts?|session|sso|iniciar-sesion|ingresar)([/._?-]|$)/i;

/** Where open_url landed, when it is not where it was sent, and whether that is a sign-in page or a bot check. */
export function landingWords(requested: string, finalUrl: string, probe: PageProbe | null): { words: string; redirected: boolean; signIn: boolean } {
  const redirected = finalUrl !== "" && pathOf(finalUrl) !== pathOf(requested);
  const signIn = probe?.password === true || (redirected && SIGN_IN_PATH.test(pathOf(finalUrl)));
  const parts: string[] = [];
  if (redirected) parts.push(`It was sent on to ${finalUrl}.`);
  if (signIn) parts.push("It is a sign-in page: list_logins, then sign_in, or ask the person.");
  if (probe?.captcha) parts.push("It shows a CAPTCHA or bot check: hand_over to the person.");
  return { words: parts.join(" "), redirected, signIn };
}

/** A sign-in's outcome in words, after "Dashi typed the password … and pressed Return." */
export function outcomeWords(outcome: SignInOutcome, seconds: number): string {
  switch (outcome.kind) {
    case "signed-in":
      return `Signed in: ${outcome.how}.`;
    case "wrong":
      return `Not signed in: the site says “${outcome.message}”. The saved password may be out of date; tell the person.`;
    case "code":
      return `The site asks for a one-time code (${outcome.how}): fill_code enters it if the login has one; else ask the person.`;
    case "captcha":
      return "The site shows a CAPTCHA or bot check: use hand_over so the person solves it.";
    case "blocked":
      return `The site blocked the sign-in: “${outcome.message}”. Don't try again; tell the person.`;
    case "loading":
      return `The page was still loading after ${seconds} s: wait_for {page: "loaded"}, then read_page.`;
    case "unchanged":
      return `Nothing changed after ${seconds} s: the form is still there${outcome.message ? ` and says “${outcome.message}”` : ""}. read_page to see why.`;
  }
}
