/**
 * Dashi's content script, in every frame from the document's start: it
 * answers the background (never the page: its messages come only through
 * chrome.runtime from this extension), reads the page as text, and acts on
 * elements by the numbers it gave them.
 */

import { readItems } from "../page/items.ts";
import { parseChords } from "../page/keys.ts";
import { isLandmark, pickMain } from "../page/main.ts";
import type { PageNode } from "../page/node.ts";
import { READ_LIMITS, type ReadLimits, readFrame } from "../page/read.ts";
import { marker } from "../page/refs.ts";
import { click, field, fill, markFilled, press, Refusal, scroll, select } from "./actions.ts";
import { startWatch } from "./changes.ts";
import { DOC, DomNode, deepActive, elementOf, refOf, watchPasswordFields, whereItWas } from "./dom.ts";
import { handleMore } from "./more.ts";

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

/** Limits a request asked for (a stale number's surroundings), never above read_page's own. */
function limitsOf(value: unknown): ReadLimits {
  if (typeof value !== "object" || value === null) return READ_LIMITS;
  const chars = "chars" in value ? value.chars : undefined;
  const elements = "elements" in value ? value.elements : undefined;
  return {
    chars: typeof chars === "number" ? Math.min(chars, READ_LIMITS.chars) : READ_LIMITS.chars,
    elements: typeof elements === "number" ? Math.min(elements, READ_LIMITS.elements) : READ_LIMITS.elements,
  };
}

/** Around a stale number, read again: at most this much. */
const AROUND_LIMITS = { chars: 3000, elements: 40 };

function target(message: Message): Element {
  if (message.doc !== DOC) throw new Refusal("That number is from a page that has gone; read_page again.");
  const ref = typeof message.ref === "number" ? message.ref : null;
  const element = ref === null ? null : elementOf(ref);
  if (element || ref === null) {
    if (!element) throw new Refusal("That element is no longer on the page; read_page again.");
    return element;
  }
  // Gone: read the part of the page where it was. A redrawn element with its key takes its number back (dom.ts refOf);
  // otherwise the error carries the fresh numbers there, so the next call needs no read of its own.
  const region = whereItWas(ref);
  if (!region) throw new Refusal("That element is no longer on the page; read_page again.");
  const origin = location.origin === "null" ? null : location.origin;
  const { text } = readFrame(new DomNode(region), (node) => refOf((node as DomNode).node), AROUND_LIMITS, origin);
  const redrawn = elementOf(ref);
  if (redrawn) return redrawn;
  throw new Refusal(`Element [${marker(ref)}] is no longer on the page. Where it was, the page now reads:\n${text || "(nothing)"}`);
}

/** A field's value after fill_element: what the page kept (it may format or cut what was typed). Never asked of a secret field: fill refuses those. */
function valueOf(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value.slice(0, 500);
  return element instanceof HTMLElement ? element.innerText.slice(0, 500) : "";
}

async function handle(message: Message): Promise<Record<string, unknown>> {
  switch (message.op) {
    case "read": {
      await settle();
      const page = new DomNode(document);
      const origin = location.origin === "null" ? null : location.origin;
      const number = (node: PageNode) => refOf((node as DomNode).node);
      if (message.mode === "items") return { doc: DOC, items: readItems(page, number, origin), title: document.title };
      const main = message.mode === "main";
      const root = main ? pickMain(page) : page;
      const { text, truncated } = readFrame(root, number, limitsOf(message.limits), origin, main ? isLandmark : undefined);
      return { doc: DOC, text, truncated, title: document.title };
    }
    case "focus":
      return { doc: DOC, hasFocus: document.hasFocus(), inFrame: document.activeElement instanceof HTMLIFrameElement };
    case "click": {
      const element = target(message);
      startWatch(element);
      return { ...click(element) };
    }
    case "fill": {
      const element = target(message);
      return { described: fill(element, String(message.text ?? "")), value: valueOf(element) };
    }
    case "select": {
      const element = target(message);
      startWatch(element);
      return { described: select(element, String(message.value ?? "")) };
    }
    case "press": {
      const chords = message.chords === undefined ? [] : parseChords(message.chords);
      if (!chords) throw new Refusal("`chords` must be a list of keys with their modifiers.");
      startWatch(deepActive());
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
    default: {
      const more = await handleMore(message);
      if (!more) throw new Refusal("Unknown request.");
      return more;
    }
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
      (error: unknown) => respond({ ok: false, doc: DOC, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  });
}
