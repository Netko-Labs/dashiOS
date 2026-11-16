/**
 * The content script's requests beyond reading and acting (main.ts): what an
 * action changed, a sign-in's outcome, a page waited on, and a look at a page
 * just opened. Each answers null when the op is not its own.
 */

import { parseWait } from "../page/wait.ts";
import { boxOf, clickAt } from "./canvas.ts";
import { changes } from "./changes.ts";
import { DOC, elementOf } from "./dom.ts";
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
    case "history": {
      // A step in the page's own history, after this answer is on its way (the page may go at once).
      const by = message.by === 1 ? 1 : -1;
      setTimeout(() => history.go(by), 0);
      return { length: history.length };
    }
    case "attach":
      return attach(message);
    case "box":
      return { ...boxOf(elementFor(message), message.picture === true) };
    case "point":
      return { target: clickAt(elementFor(message), Number(message.x ?? 0.5), Number(message.y ?? 0.5)) };
    case "probe": {
      const facts = pageFacts(location.href, "password");
      return { url: location.href, title: document.title, password: facts.fieldShows, captcha: facts.captcha };
    }
    default:
      return null;
  }
}

/** The element a message names, in this document. */
function elementFor(message: Message): Element {
  const element = message.doc === DOC && typeof message.ref === "number" ? elementOf(message.ref) : null;
  if (!element) throw new Error("That element is no longer on the page; read_page again.");
  return element;
}

/** A file put into a page's file field as if the person had chosen it: no chooser, the page hears input and change. */
function attach(message: Message): Record<string, unknown> {
  const element = elementFor(message);
  if (!(element instanceof HTMLInputElement) || element.type !== "file") throw new Error("That isn't a file field (a file chooser read_page numbered).");
  if (element.disabled) throw new Error("That file field is disabled.");
  const binary = atob(String(message.data ?? ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const file = new File([bytes], String(message.name ?? "file"), { type: String(message.type ?? "") });
  const transfer = new DataTransfer();
  if (element.multiple) for (const kept of element.files ?? []) transfer.items.add(kept);
  transfer.items.add(file);
  element.files = transfer.files;
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  const accept = element.accept.trim();
  return { files: element.files?.length ?? 0, ...(accept ? { accept } : {}) };
}
