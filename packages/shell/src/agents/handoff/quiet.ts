/**
 * A run that says nothing (docs/actions.md, "Agents from the launcher"):
 * every harness prints its first event at once (its session), so a turn
 * still silent after `QUIET_MS` is stuck. OpenCode with no account is the
 * one seen: its free model is at its limit, it prints no event and never
 * exits. The card then asks the person, in plain words, what is wrong and
 * what to do: sign in or keep waiting, and the card's Stop stops it (service.ts asks; the panel
 * shows it as a question, its Stop under it). What the harness wrote to its errors
 * (`turn-N.jsonl.err`) and whether it is signed in say which words.
 */

import type { RunQuestion } from "./store.ts";

/** How long a turn may print nothing before the person is asked. */
export const QUIET_MS = 30_000;

export type QuietReason = "signed-out" | "limit" | "quiet";

/** Words a harness uses when it isn't signed in, or its login lapsed. */
const SIGNED_OUT =
  /not (?:logged|signed) in|\blog ?in\b|sign ?in|unauthori[sz]ed|\b401\b|authenticat|no (?:api )?key|invalid api key|api key|no providers?\b|credentials/i;
/** Words for a model at its limit. */
const LIMIT =
  /rate.?limit|quota|usage limit|too many requests|\b429\b|limit (?:reached|exceeded)|exceeded .*limit|free (?:tier|model)|insufficient credit|out of credits?/i;

/**
 * Why a turn is silent: its errors say it isn't signed in, or that its model
 * is at its limit; else a harness that isn't known to be signed in (`signedIn`
 * not true) is taken as signed out, and one that is, as merely quiet.
 */
export function quietReason(errors: string, signedIn: boolean | null): QuietReason {
  if (LIMIT.test(errors)) return "limit";
  if (SIGNED_OUT.test(errors)) return "signed-out";
  return signedIn === true ? "quiet" : "signed-out";
}

/** The card's question for a silent turn. `signIn` is what to type in Terminal ("opencode auth login"), when there is one. */
export function quietQuestion(name: string, reason: QuietReason, signIn: string | null, seconds = Math.round(QUIET_MS / 1000)): Omit<RunQuestion, "id"> {
  const wait = { id: "wait", label: "Keep Waiting" };
  const signInChoice = signIn ? [{ id: "sign-in", label: "Sign In…", primary: true as const }] : [];
  switch (reason) {
    case "signed-out":
      return {
        kind: "stuck",
        title: `${name} isn't signed in`,
        detail: `It hasn't answered in ${seconds} seconds.${signIn ? ` Sign in to a provider in Terminal (${signIn}), then ask again.` : " Sign it in, then ask again."}`,
        choices: [...signInChoice, wait],
        needs: "isn't signed in",
      };
    case "limit":
      return {
        kind: "stuck",
        title: `${name} is at its limit`,
        detail: `Its model has had too many requests. Try again later${signIn ? `, or sign in to your own provider (${signIn})` : ""}.`,
        choices: [...signInChoice, wait],
        needs: "is at its limit",
      };
    case "quiet":
      return {
        kind: "stuck",
        title: `${name} isn't answering`,
        detail: `Nothing from it in ${seconds} seconds.`,
        choices: [wait],
        needs: "isn't answering",
      };
  }
}

/** A failure in plain words when it is one of these; the harness's own words otherwise. */
export function plainFailure(name: string, error: string): string {
  if (LIMIT.test(error)) return `${name}'s model is at its limit. Try again later.`;
  if (SIGNED_OUT.test(error)) return `${name} isn't signed in.`;
  return error;
}

/** The last lines of a harness's errors, at most `most` characters. */
export const lastErrors = (text: string, most = 2000): string => (text.length > most ? text.slice(-most) : text).trim();
