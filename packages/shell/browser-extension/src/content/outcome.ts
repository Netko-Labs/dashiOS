/**
 * The page after a sign-in's Return (sign_in, fill_code): its facts read from
 * the DOM, and watched (a MutationObserver) until page/outcome.ts can tell
 * what happened or the time is up. Never a field's value: only whether a
 * password or code field still shows.
 */

import { secrecyOf } from "../page/node.ts";
import { type Outcome, type PageFacts, readOutcome } from "../page/outcome.ts";
import { DomNode } from "./dom.ts";

/** The page is settled once nothing changed for this long. */
const SETTLED_MS = 400;
const CHECK_MS = 100;

const CAPTCHA_FRAME = /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|captcha/i;
const CAPTCHA_WORDS = /verify (that )?you are (a )?human|i.?m not a robot|no soy un robot|security check|are you a robot|confirm you.?re human/i;
const ALERTS =
  "[role=alert], [aria-live=assertive], [aria-live=polite], [aria-invalid=true], .error, .errors, [class*=error i], [id*=error i], [class*=alert i]";

const visible = (element: Element): boolean => element.checkVisibility({ checkVisibilityCSS: true } as CheckVisibilityOptions);

function fieldsOf(kind: "password" | "code"): boolean {
  for (const input of document.querySelectorAll("input, textarea")) {
    if (!visible(input)) continue;
    const secrecy = secrecyOf(new DomNode(input));
    if (secrecy === kind || (kind === "password" && (input as HTMLInputElement).type === "password")) return true;
  }
  return false;
}

/** What the page shows now, as page/outcome.ts reads it. */
export function pageFacts(urlBefore: string, field: "password" | "code"): PageFacts {
  const alerts: string[] = [];
  for (const element of document.querySelectorAll(ALERTS)) {
    if (alerts.length >= 5 || !visible(element)) continue;
    const text = (element instanceof HTMLElement ? element.innerText : (element.textContent ?? "")).replace(/\s+/g, " ").trim();
    if (text && text.length <= 300 && !alerts.includes(text)) alerts.push(text);
  }
  const text = (document.body?.innerText ?? "").slice(0, 5000);
  const captcha =
    [...document.querySelectorAll("iframe")].some((frame) => CAPTCHA_FRAME.test(frame.src) && visible(frame)) ||
    document.querySelector("[data-sitekey], .g-recaptcha, .h-captcha, .cf-turnstile") !== null ||
    CAPTCHA_WORDS.test(text);
  return {
    urlBefore,
    url: location.href,
    fieldShows: fieldsOf(field),
    codeShows: field === "password" && fieldsOf("code"),
    captcha,
    alerts,
    text,
    loading: document.readyState !== "complete",
  };
}

/** Until the page shows an outcome, or `until` (ms since the epoch); then what it shows. */
export function watchOutcome(urlBefore: string, field: "password" | "code", until: number): Promise<Outcome> {
  return new Promise((resolve) => {
    let lastChange = performance.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      lastChange = performance.now();
      timer ??= setTimeout(test, CHECK_MS);
    });
    const tick = setInterval(test, SETTLED_MS);
    const deadline = setTimeout(() => test(true), Math.max(0, until - Date.now()));
    function test(final = false) {
      timer = null;
      const settled = performance.now() - lastChange >= SETTLED_MS;
      const outcome = readOutcome(pageFacts(urlBefore, field), field, settled, final || Date.now() >= until);
      if (outcome.kind === "pending") return;
      observer.disconnect();
      clearInterval(tick);
      clearTimeout(deadline);
      if (timer) clearTimeout(timer);
      resolve(outcome);
    }
    observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    test();
  });
}
