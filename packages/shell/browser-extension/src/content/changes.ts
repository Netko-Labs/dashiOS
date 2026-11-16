/**
 * What an action did to the page, for honest results: a watch starts just
 * before click_element, press or select_option acts, and `changes()` reads
 * it once the page has been quiet a moment (or after 1.5 s, however busy it
 * stays): whether the DOM changed near the element or elsewhere, a dialog
 * that opened, text that appeared, whether the element is still there and
 * what it is now, and where the keyboard went.
 */

import { roleOf } from "../page/node.ts";
import { describeElement } from "../page/read.ts";
import { DomNode, deepActive } from "./dom.ts";

const QUIET_MS = 300;
const MAX_MS = 1500;
const DIALOGS = "dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]";

export interface Changes {
  /** The DOM changed: "near" the element (its block), "elsewhere", or "none". */
  changed: "near" | "elsewhere" | "none";
  /** The element is still in the page. */
  still: boolean;
  /** What the element is now ("checkbox "Remember me" (checked)"), when it is still there. */
  now?: string;
  /** A dialog that opened, by its name or first words. */
  dialog?: string;
  /** Text that appeared, the first 200 characters. */
  appeared?: string;
  /** Where the keyboard focus went, when it moved. */
  focus?: string;
}

interface Watch {
  element: Element | null;
  near: Element | null;
  observer: MutationObserver;
  lastChange: number;
  touchedNear: boolean;
  touched: boolean;
  added: string[];
  dialogs: Set<Element>;
  focus: Element | null;
}

let watch: Watch | null = null;

const shown = (element: Element): boolean => element.checkVisibility({ checkVisibilityCSS: true } as CheckVisibilityOptions);

const describe = (element: Element): string => {
  const node = new DomNode(element);
  const role = roleOf(node);
  return role ? describeElement(node, role) : element.localName;
};

/** The block an element sits in: a form, a list item, a section, else three levels up. */
function blockOf(element: Element): Element {
  const block = element.closest("form, li, tr, section, article, [role=dialog], [role=listitem], [role=row]");
  return block ?? element.parentElement?.parentElement?.parentElement ?? element;
}

/** Start watching, just before an action on `element` (null: the page's focus, for keys). */
export function startWatch(element: Element | null): void {
  watch?.observer.disconnect();
  const near = element ? blockOf(element) : null;
  const state: Watch = {
    element,
    near,
    lastChange: performance.now(),
    touchedNear: false,
    touched: false,
    added: [],
    dialogs: new Set([...document.querySelectorAll(DIALOGS)].filter(shown)),
    focus: deepActive(),
    observer: new MutationObserver((records) => {
      state.lastChange = performance.now();
      state.touched = true;
      for (const record of records) {
        if (near?.contains(record.target) || (record.target instanceof Node && record.target.contains(near))) state.touchedNear = true;
        for (const node of record.addedNodes) {
          const text = (node instanceof HTMLElement ? node.innerText : node.nodeType === Node.TEXT_NODE ? node.nodeValue : "") ?? "";
          if (text.trim() && state.added.join(" ").length < 400) state.added.push(text.replace(/\s+/g, " ").trim());
        }
      }
    }),
  };
  state.observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  watch = state;
}

const nameOf = (dialog: Element): string => {
  const label = dialog.getAttribute("aria-label") ?? dialog.querySelector("h1, h2, h3, [role=heading]")?.textContent ?? (dialog as HTMLElement).innerText ?? "";
  return label.replace(/\s+/g, " ").trim().slice(0, 100);
};

/** Once the page has been quiet a moment: what the action did. */
export async function changes(): Promise<Changes> {
  const state = watch;
  if (!state) return { changed: "none", still: true };
  const started = performance.now();
  while (performance.now() - state.lastChange < QUIET_MS && performance.now() - started < MAX_MS) {
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS - (performance.now() - state.lastChange) + 10));
  }
  state.observer.disconnect();
  watch = null;
  const out: Changes = { changed: state.touchedNear ? "near" : state.touched ? "elsewhere" : "none", still: state.element?.isConnected ?? true };
  if (state.element?.isConnected) out.now = describe(state.element);
  const opened = [...document.querySelectorAll(DIALOGS)].find((dialog) => shown(dialog) && !state.dialogs.has(dialog));
  if (opened) out.dialog = nameOf(opened) || "a dialog";
  const appeared = state.added.join(" ").slice(0, 200);
  if (appeared) out.appeared = appeared;
  const focus = deepActive();
  if (focus && focus !== state.focus && focus !== document.body) out.focus = describe(focus);
  return out;
}
