/**
 * The page's DOM as the reader's `PageNode` (page/node.ts), and the numbers
 * this document gives its elements. Open shadow roots are read as the page
 * shows them (their slots filled). A secret field's value is never read
 * here except as "is there anything" (`hasValue`).
 */

import type { PageNode, PageOption } from "../page/node.ts";

/** This document's name for the background: numbers from another document are refused. */
export const DOC = Math.random().toString(36).slice(2, 10);

const numbers = new WeakMap<Node, number>();
const byNumber = new Map<number, WeakRef<Element>>();
let next = 1;

/** The element's number in this document, the same every time. */
export function refOf(node: Node): number {
  let ref = numbers.get(node);
  if (ref === undefined) {
    ref = next++;
    numbers.set(node, ref);
    if (node instanceof Element) byNumber.set(ref, new WeakRef(node));
  }
  return ref;
}

/** The element a number names, if it is still in the page. */
export function elementOf(ref: number): Element | null {
  const element = byNumber.get(ref)?.deref() ?? null;
  return element?.isConnected ? element : null;
}

/** Fields that were password fields (a "show password" button turns them to text): they stay secret. */
export const wasPassword = new WeakSet<Element>();
/** Fields Dashi typed a secret into. */
export const dashiFilled = new WeakSet<Element>();

/** From the document's start: a field whose type stops being "password" is remembered. */
export function watchPasswordFields(): void {
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.oldValue?.toLowerCase() === "password" && record.target instanceof Element) wasPassword.add(record.target);
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["type"], attributeOldValue: true });
}

const BLOCK = new Set([
  "block",
  "flex",
  "grid",
  "list-item",
  "table",
  "table-row",
  "flow-root",
  "table-caption",
  "table-row-group",
  "table-header-group",
  "table-footer-group",
]);

/** Text an element shows, without what fields hold (a label around a select would otherwise list its options). */
export function plainText(element: Element): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue ?? "";
    else if (node instanceof Element && !["SELECT", "TEXTAREA", "SCRIPT", "STYLE", "OPTION"].includes(node.tagName)) node.childNodes.forEach(walk);
  };
  walk(element);
  return out;
}

type Valued = HTMLInputElement | HTMLTextAreaElement;
const isValued = (element: Element): element is Valued => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;

export class DomNode implements PageNode {
  readonly tag: string;

  constructor(readonly node: Node) {
    this.tag = node.nodeType === Node.TEXT_NODE ? "#text" : node instanceof Element ? node.localName : "#other";
  }

  private get element(): Element | null {
    return this.node instanceof Element ? this.node : null;
  }

  text(): string {
    return this.node.nodeValue ?? "";
  }

  attr(name: string): string | null {
    return this.element?.getAttribute(name) ?? null;
  }

  children(): PageNode[] {
    const element = this.element;
    let nodes: Node[];
    if (element instanceof HTMLSlotElement) nodes = element.assignedNodes({ flatten: true });
    else if (element?.shadowRoot) nodes = [...element.shadowRoot.childNodes];
    else
      nodes = [
        ...(this.node.nodeType === Node.DOCUMENT_NODE ? [(this.node as Document).body ?? (this.node as Document).documentElement] : this.node.childNodes),
      ];
    return nodes
      .filter((node): node is Node => node !== null && (node.nodeType === Node.TEXT_NODE || node instanceof Element))
      .map((node) => new DomNode(node));
  }

  shown(): boolean {
    const element = this.element;
    if (!element) return true;
    if (element.getAttribute("aria-hidden") === "true" || element.hasAttribute("hidden")) return false;
    if (element instanceof HTMLSlotElement || getComputedStyle(element).display === "contents") return true;
    return element.checkVisibility({ checkVisibilityCSS: true } as CheckVisibilityOptions);
  }

  block(): boolean {
    const element = this.element;
    return element !== null && BLOCK.has(getComputedStyle(element).display);
  }

  value(): string {
    const element = this.element;
    if (!element) return "";
    if (isValued(element)) return element.value;
    return element instanceof HTMLElement && element.isContentEditable ? element.innerText : "";
  }

  hasValue(): boolean {
    const element = this.element;
    if (!element) return false;
    if (isValued(element)) return element.value.length > 0;
    return (element.textContent ?? "").trim().length > 0;
  }

  checked(): boolean {
    const element = this.element;
    if (element instanceof HTMLInputElement) return element.checked;
    return element?.getAttribute("aria-checked") === "true";
  }

  options(): PageOption[] {
    const element = this.element;
    if (!(element instanceof HTMLSelectElement)) return [];
    return [...element.options].map((option) => ({ label: option.label || option.text, value: option.value, selected: option.selected }));
  }

  labelText(): string | null {
    const element = this.element;
    if (!element) return null;
    const ids = element.getAttribute("aria-labelledby");
    if (ids) {
      const root = element.getRootNode() as Document | ShadowRoot;
      const text = ids
        .split(/\s+/)
        .map((id) => root.getElementById?.(id) ?? document.getElementById(id))
        .filter((label): label is HTMLElement => label !== null)
        .map(plainText)
        .join(" ");
      if (text.trim()) return text;
    }
    const labels = (element as HTMLInputElement).labels;
    if (labels && labels.length > 0) return [...labels].map(plainText).join(" ");
    return null;
  }

  href(): string | null {
    const element = this.element;
    return element instanceof HTMLAnchorElement ? element.href : null;
  }

  disabled(): boolean {
    const element = this.element;
    if (!element) return false;
    return (element as HTMLInputElement).disabled === true || element.getAttribute("aria-disabled") === "true";
  }

  wasPassword(): boolean {
    const element = this.element;
    if (!element) return false;
    if (element instanceof HTMLInputElement && element.type === "password") wasPassword.add(element);
    return wasPassword.has(element);
  }

  dashiFilled(): boolean {
    const element = this.element;
    return element !== null && dashiFilled.has(element);
  }

  labelsField(): boolean {
    const element = this.element;
    return element instanceof HTMLLabelElement && element.control !== null;
  }
}

/** The element with the keyboard focus, through open shadow roots (an iframe when the focus is in a frame). */
export function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
