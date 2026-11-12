/**
 * Dashi's content script, in every frame from the document's start: it
 * answers the background (never the page: its messages come only through
 * chrome.runtime from this extension), reads the page as text, and acts on
 * elements by the numbers it gave them.
 */

import { parseChords } from "../page/keys.ts";
import { readFrame } from "../page/read.ts";
import { click, field, fill, markFilled, press, Refusal, scroll, select } from "./actions.ts";
import { DOC, DomNode, deepActive, elementOf, refOf, watchPasswordFields } from "./dom.ts";

/** The DOM is quiet once nothing has changed for this long (a page drawing itself after load). */
const QUIET_MS = 150;
/** …or after this long, however busy it stays. */
const SETTLE_MAX_MS = 1500;

function settle(): Promise<void> {
  return new Promise((resolve) => {
    const start = () => {
      let timer = setTimeout(done, QUIET_MS);
      const cap = setTimeout(done, SETTLE_MAX_MS);
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(done, QUIET_MS);
      });
      observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      function done() {
        clearTimeout(timer);
        clearTimeout(cap);
        observer.disconnect();
        resolve();
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  });
}

const SCROLLS = ["up", "down", "top", "bottom"] as const;

type Message = Record<string, unknown> & { op?: unknown };

const isMessage = (value: unknown): value is Message => typeof value === "object" && value !== null && !Array.isArray(value);

function target(message: Message): Element {
  if (message.doc !== DOC) throw new Refusal("That number is from a page that has gone; read_page again.");
  const element = typeof message.ref === "number" ? elementOf(message.ref) : null;
  if (!element) throw new Refusal("That element is no longer on the page; read_page again.");
  return element;
}

async function handle(message: Message): Promise<Record<string, unknown>> {
  switch (message.op) {
    case "read": {
      await settle();
      const root = new DomNode(document);
      const origin = location.origin === "null" ? null : location.origin;
      const { text, truncated } = readFrame(root, (node) => refOf((node as DomNode).node), undefined, origin);
      return { doc: DOC, text, truncated, title: document.title };
    }
    case "focus":
      return { doc: DOC, hasFocus: document.hasFocus(), inFrame: document.activeElement instanceof HTMLIFrameElement };
    case "click":
      return { ...click(target(message)) };
    case "fill":
      return { described: fill(target(message), String(message.text ?? "")) };
    case "select":
      return { described: select(target(message), String(message.value ?? "")) };
    case "press": {
      const chords = message.chords === undefined ? [] : parseChords(message.chords);
      if (!chords) throw new Refusal("`chords` must be a list of keys with their modifiers.");
      return { did: press(chords) };
    }
    case "scroll": {
      const how = SCROLLS.find((each) => each === message.how) ?? "down";
      const element = typeof message.ref === "number" ? target(message) : null;
      return scroll(how, typeof message.pages === "number" ? message.pages : 1, element);
    }
    case "field": {
      const element = typeof message.ref === "number" ? target(message) : deepActive();
      return { doc: DOC, ...field(element, message.focus === true) };
    }
    case "filled": {
      const element = typeof message.ref === "number" ? target(message) : deepActive();
      if (element) markFilled(element);
      return {};
    }
    default:
      throw new Refusal("Unknown request.");
  }
}

declare global {
  // Injected twice (the manifest's, then scripting's into a tab that was open before): one listener only.
  var __dashiContent: boolean | undefined;
}

if (!globalThis.__dashiContent) {
  globalThis.__dashiContent = true;
  watchPasswordFields();
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !isMessage(message)) return undefined;
    handle(message).then(
      (result) => respond({ ok: true, result }),
      (error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  });
}
