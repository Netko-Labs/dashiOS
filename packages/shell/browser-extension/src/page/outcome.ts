/**
 * What happened after Dashi pressed Return on a sign-in or a code: the page's
 * facts (gathered by content/outcome.ts) read into one outcome, so sign_in
 * says "signed in", "wrong password", "a code is asked for", "a CAPTCHA",
 * "blocked", "still loading" or "nothing changed", never "submitted" alone.
 * Pure, so it is tested with made-up pages.
 */

export interface PageFacts {
  /** The address before Dashi pressed Return, and now. */
  urlBefore: string;
  url: string;
  /** A password field shows (for a code: a code field). */
  fieldShows: boolean;
  /** A one-time code field shows. */
  codeShows: boolean;
  /** A CAPTCHA or bot check shows (its frame, a site key, its words). */
  captcha: boolean;
  /** Short texts the page shows as errors or alerts, in order. */
  alerts: readonly string[];
  /** The page's shown text (bounded), for words that say blocked or a code. */
  text: string;
  /** The tab is loading. */
  loading: boolean;
}

export type Outcome =
  | { kind: "signed-in"; how: string }
  | { kind: "wrong"; message: string }
  | { kind: "code"; how: string }
  | { kind: "captcha" }
  | { kind: "blocked"; message: string }
  | { kind: "loading" }
  | { kind: "unchanged"; message?: string }
  | { kind: "pending" };

const WRONG =
  /\b(incorrect|wrong|invalid|isn.t right|doesn.t match|not recognized|couldn.t find|try again|incorrect[ao]s?|inv[aá]lid[ao]s?|no coincide|no es correct[ao]|err[oó]ne[ao])\b/i;
const BLOCKED =
  /(temporarily (locked|blocked|disabled)|too many (attempts|tries|requests)|account (is |has been )?(locked|disabled|suspended)|unusual activity|suspicious activity|demasiados intentos|bloquead[ao]|access denied)/i;
const ASKS_CODE =
  /(verification code|security code|enter the code|we sent (you )?a code|two-factor|2-step|two-step|authenticator app|código de verificación|ingresa el código|introduce el código)/i;

const pathOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
};

/** The first alert that reads like a wrong password (or code), cut to one line. */
const wrongAlert = (alerts: readonly string[]): string | null => alerts.find((alert) => WRONG.test(alert))?.slice(0, 200) ?? null;

/**
 * The outcome the page shows now. `settled` says the page has been quiet a
 * moment; `final` that time is up: only then is "nothing changed" an answer.
 * `field` is what Dashi typed: a password, or a code.
 */
export function readOutcome(facts: PageFacts, field: "password" | "code", settled: boolean, final: boolean): Outcome {
  if (facts.captcha) return { kind: "captcha" };
  const blocked = facts.alerts.find((alert) => BLOCKED.test(alert)) ?? facts.text.match(BLOCKED)?.[0] ?? null;
  if (blocked) return { kind: "blocked", message: blocked.slice(0, 200) };
  const wrong = wrongAlert(facts.alerts);
  if (wrong && facts.fieldShows) return { kind: "wrong", message: wrong };
  if (field === "password" && (facts.codeShows || (!facts.fieldShows && ASKS_CODE.test(facts.text)))) {
    return { kind: "code", how: facts.codeShows ? "a one-time code field shows" : "the page asks for a code" };
  }
  const moved = pathOf(facts.url) !== pathOf(facts.urlBefore);
  if (!facts.fieldShows && !facts.loading && settled) {
    const what = field === "password" ? "the password field" : "the code field";
    return { kind: "signed-in", how: moved ? `${what} is gone and the address changed` : `${what} is gone (the address stayed the same)` };
  }
  if (!final) return { kind: "pending" };
  if (facts.loading) return { kind: "loading" };
  const alert = facts.alerts[0];
  return alert ? { kind: "unchanged", message: alert.slice(0, 200) } : { kind: "unchanged" };
}
