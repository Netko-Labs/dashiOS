/**
 * What the content script does to the page for the agent: click, fill,
 * choose an option, press keys, scroll, and report a field for sign-in.
 * Secret fields are refused here as well as in the shell: fill and typed
 * characters never go into a password, card or code field (sign_in, fill_code
 * and pay are Dashi's), and their values are never read.
 */

import { defaultAction, domKey, type PressChord } from "../page/keys.ts";
import { isField, roleOf, secrecyOf } from "../page/node.ts";
import { describeElement } from "../page/read.ts";
import { DomNode, dashiFilled, deepActive } from "./dom.ts";

export class Refusal extends Error {}

const describe = (element: Element): string => {
  const node = new DomNode(element);
  const role = roleOf(node);
  return role ? describeElement(node, role) : element.localName;
};

const SECRET_REFUSAL =
  "That is a password, card or one-time code field: Dashi fills those itself (sign_in, fill_code, pay), so the agent never holds the secret.";

function pointerAt(element: Element, type: string): void {
  const rect = element.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, view: window };
  const event = type.startsWith("pointer") ? new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true }) : new MouseEvent(type, init);
  element.dispatchEvent(event);
}

export interface Clicked {
  described: string;
  /** A link that opens a new tab: the background opens it (a script's click may not). */
  openTab?: string;
  /** It is a link or a submit button: a page may load next. */
  mayNavigate: boolean;
}

export function click(element: Element): Clicked {
  element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const described = describe(element);
  if (element instanceof HTMLAnchorElement && element.target === "_blank" && element.href && !/^javascript:/i.test(element.href)) {
    return { described, openTab: element.href, mayNavigate: false };
  }
  for (const type of ["pointerover", "mouseover", "pointerdown", "mousedown"]) pointerAt(element, type);
  if (element instanceof HTMLElement) element.focus({ preventScroll: true });
  for (const type of ["pointerup", "mouseup"]) pointerAt(element, type);
  if (element instanceof HTMLElement) element.click();
  else pointerAt(element, "click");
  const submit =
    (element instanceof HTMLButtonElement && element.type === "submit" && element.form !== null) ||
    (element instanceof HTMLInputElement && element.type === "submit");
  return { described, mayNavigate: element instanceof HTMLAnchorElement || submit };
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

/** Set a field's value as typing would: the browser's own insertText, else the value's setter and the events frameworks listen for. */
function setText(element: Element, text: string): void {
  if (!(element instanceof HTMLElement)) throw new Refusal("That element doesn't take text.");
  element.focus({ preventScroll: true });
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.select();
    const typed = text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, text);
    if (!typed || element.value !== text) {
      const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element as TextField, text);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.execCommand("insertText", false, text);
}

export function fill(element: Element, text: string): string {
  const node = new DomNode(element);
  if (secrecyOf(node)) throw new Refusal(SECRET_REFUSAL);
  if (element instanceof HTMLSelectElement) throw new Refusal("That is a list to choose from: use select_option.");
  if (!isField(node)) throw new Refusal(`That is a ${roleOf(node) ?? element.localName}, which doesn't take text; click_element it instead.`);
  if ((element as HTMLInputElement).disabled || (element as HTMLInputElement).readOnly) throw new Refusal("That field is disabled or read-only.");
  element.scrollIntoView({ block: "center", behavior: "instant" });
  setText(element, text);
  return describe(element);
}

export function select(element: Element, wanted: string): string {
  if (!(element instanceof HTMLSelectElement)) {
    throw new Refusal("That isn't a list with options (a <select>): click it, read_page, then click the option.");
  }
  const options = [...element.options];
  const lower = wanted.toLowerCase().trim();
  const option =
    options.find((o) => o.value === wanted || o.label === wanted || o.text === wanted) ??
    options.find((o) => o.value.toLowerCase() === lower || o.text.toLowerCase().trim() === lower) ??
    options.find((o) => o.text.toLowerCase().includes(lower));
  if (!option) throw new Refusal(`No option is called “${wanted}”; read_page lists them.`);
  element.value = option.value;
  option.selected = true;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return describe(element);
}

const FOCUSABLE = "a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable=''], [contenteditable=true]";

/** The page's fields in Tab order. */
function tabbable(): HTMLElement[] {
  const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0 && !(element as HTMLInputElement).disabled && element.checkVisibility(),
  );
  const positive = all.filter((element) => element.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
  return [...positive, ...all.filter((element) => element.tabIndex === 0)];
}

function moveFocus(from: Element | null, step: 1 | -1): void {
  const order = tabbable();
  const at = from instanceof HTMLElement ? order.indexOf(from) : -1;
  const next = order[(at + step + order.length) % order.length];
  next?.focus();
}

function activate(target: Element): void {
  if (target instanceof HTMLInputElement && target.form && isField(new DomNode(target))) {
    const submit = target.form.querySelector<HTMLElement>("button:not([type]), button[type=submit], input[type=submit], input[type=image]");
    if (submit) submit.click();
    else target.form.requestSubmit();
  } else if (target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) {
    document.execCommand("insertLineBreak");
  } else if (target instanceof HTMLElement) {
    target.click();
  }
}

function scrollBy(how: "up" | "down" | "left" | "right" | "page-up" | "page-down" | "top" | "bottom"): void {
  const page = innerHeight * 0.85;
  const moves: Record<typeof how, ScrollToOptions> = {
    up: { top: -40 },
    down: { top: 40 },
    left: { left: -40 },
    right: { left: 40 },
    "page-up": { top: -page },
    "page-down": { top: page },
    top: { top: -document.documentElement.scrollHeight },
    bottom: { top: document.documentElement.scrollHeight },
  };
  window.scrollBy({ ...moves[how], behavior: "instant" });
}

/** Keys, one chord at a time, to whatever has the focus; what the page doesn't prevent is done as the browser would. */
export function press(chords: readonly PressChord[]): string[] {
  const did: string[] = [];
  for (const chord of chords) {
    const key = domKey(chord);
    if (!key) throw new Refusal(`The page can't be sent ${chord.key}.`);
    const target = deepActive() ?? document.body;
    const node = new DomNode(target);
    const inField = isField(node);
    const init = {
      ...key,
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: chord.mods.includes("shift"),
      ctrlKey: chord.mods.includes("ctrl") || chord.mods.includes("super"),
      altKey: chord.mods.includes("alt"),
    };
    const allowed = target.dispatchEvent(new KeyboardEvent("keydown", init));
    const action = defaultAction(chord, inField, ["button", "checkbox", "radio", "switch", "link"].includes(roleOf(node) ?? ""));
    if (allowed && action) {
      if (typeof action === "object" && "insert" in action) {
        if (secrecyOf(node)) throw new Refusal(SECRET_REFUSAL);
        target.dispatchEvent(new KeyboardEvent("keypress", init));
        document.execCommand("insertText", false, action.insert);
      } else if (typeof action === "object") scrollBy(action.scroll);
      else if (action === "activate") activate(target);
      else if (action === "toggle") (target as HTMLElement).click();
      else if (action === "next-field" || action === "previous-field") moveFocus(target, action === "next-field" ? 1 : -1);
      else if (action === "erase-back") document.execCommand("delete");
      else if (action === "erase-forward") document.execCommand("forwardDelete");
      else if (action === "select-all") document.execCommand("selectAll");
    }
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    did.push(`${key.key === " " ? "Space" : key.key}${allowed ? "" : " (the page handled it)"}`);
  }
  return did;
}

export function scroll(how: "up" | "down" | "top" | "bottom", pages: number, element: Element | null): Record<string, number | boolean> {
  if (element) element.scrollIntoView({ block: "center", behavior: "instant" });
  else if (how === "top" || how === "bottom") scrollBy(how);
  else window.scrollBy({ top: (how === "down" ? 1 : -1) * pages * innerHeight * 0.85, behavior: "instant" });
  const height = document.documentElement.scrollHeight;
  return { scrollY: Math.round(scrollY), height, viewport: innerHeight, atTop: scrollY <= 0, atEnd: scrollY + innerHeight >= height - 2 };
}

/** A field for sign-in's check: what it is now (a real password field only by its type now), and where. */
export function field(element: Element | null, focus: boolean): Record<string, unknown> {
  if (!element) return { kind: "other", focused: false, rect: null, viewport: { width: innerWidth, height: innerHeight } };
  if (focus && element instanceof HTMLElement) {
    element.scrollIntoView({ block: "center", behavior: "instant" });
    element.focus();
  }
  const node = new DomNode(element);
  const editable = isField(node) && !(element as HTMLInputElement).disabled && !(element as HTMLInputElement).readOnly;
  const kind = element instanceof HTMLInputElement && element.type === "password" ? "password" : editable ? "text" : "other";
  const rect = element.getBoundingClientRect();
  return {
    kind,
    focused: deepActive() === element,
    rect: window === window.top ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    viewport: { width: innerWidth, height: innerHeight },
  };
}

export function markFilled(element: Element): void {
  dashiFilled.add(element);
}
