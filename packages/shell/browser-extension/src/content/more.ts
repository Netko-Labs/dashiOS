/**
 * The content script's requests beyond reading and acting (main.ts): what an
 * action changed, a sign-in's outcome, a page waited on, and a look at a page
 * just opened. Each answers null when the op is not its own.
 */

import { parseWait } from "../page/wait.ts";
import { changes } from "./changes.ts";
import { DOC } from "./dom.ts";
import { pageFacts, watchOutcome } from "./outcome.ts";
import { waitInPage } from "./wait.ts";

type Message = Record<string, unknown>;

const MAX_WAIT_MS = 60_000;

const left = (message: Message, fallback: number): number =>
  Math.max(0, Math.min(typeof message.until === "number" ? message.until - Date.now() : fallback, MAX_WAIT_MS));

export async function handleMore(message: Message): Promise<Record<string, unknown> | null> {
  switch (message.op) {
    case "wait": {
      const wait = parseWait(message);
      if (!wait) return { met: false, ms: 0, detail: "nothing to wait for" };
      if (wait.kind === "element" && message.doc !== DOC) return { met: wait.state === "gone", ms: 0, gone: true };
      return { ...(await waitInPage(wait, left(message, 10_000))) };
    }
    case "changes":
      return { ...(await changes()) };
    case "outcome": {
      const field = message.field === "code" ? "code" : "password";
      const until = Date.now() + left(message, 15_000);
      return { outcome: await watchOutcome(String(message.urlBefore ?? ""), field, until), url: location.href, title: document.title };
    }
    case "probe": {
      const facts = pageFacts(location.href, "password");
      return { url: location.href, title: document.title, password: facts.fieldShows, captcha: facts.captcha };
    }
    default:
      return null;
  }
}
