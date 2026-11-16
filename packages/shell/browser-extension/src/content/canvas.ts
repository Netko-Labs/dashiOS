/**
 * For elements with no DOM inside to read (a canvas, a chess board drawn by
 * script): where an element is (its box in the viewport, so the shell can
 * click a point of it with the agent's pointer, or the background can crop a
 * picture to it), and, where the agent's pointer can't reach (a frame), a
 * click by page events at a point of it. A box that holds or touches a
 * password, card or code field is refused: a picture must never show one.
 */

import { secrecyOf } from "../page/node.ts";
import { DomNode } from "./dom.ts";

export interface Box {
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  dpr: number;
  /** The page's own frame: the agent's pointer and the tab's picture reach it. */
  top: boolean;
}

const overlaps = (a: DOMRect, b: DOMRect): boolean => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

/** Whether a secret field shows inside or across the box. */
function secretIn(rect: DOMRect): boolean {
  for (const field of document.querySelectorAll("input, textarea, [contenteditable]")) {
    if (!secrecyOf(new DomNode(field))) continue;
    const box = field.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && overlaps(rect, box)) return true;
  }
  return false;
}

/** The element brought into view, and where it is. */
export function boxOf(element: Element, picture: boolean): Box {
  const before = element.getBoundingClientRect();
  if (before.top < 0 || before.left < 0 || before.bottom > innerHeight || before.right > innerWidth) {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  }
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) throw new Error("That element takes no room on the page (hidden, or empty).");
  if (picture && secretIn(rect)) throw new Error("A password, card or code field is inside that area, so Dashi won't take its picture.");
  return {
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: innerWidth, height: innerHeight },
    dpr: devicePixelRatio,
    top: window === window.top,
  };
}

/** A click by page events at a point of the element (fractions of its box): for a frame the agent's pointer can't reach. */
export function clickAt(element: Element, fx: number, fy: number): string {
  const { rect } = boxOf(element, false);
  const x = rect.x + fx * rect.width;
  const y = rect.y + fy * rect.height;
  const target = document.elementFromPoint(x, y) ?? element;
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
  for (const type of ["pointerover", "pointermove", "pointerdown"])
    target.dispatchEvent(new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true, buttons: 1 }));
  target.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
  target.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mouseup", init));
  target.dispatchEvent(new MouseEvent("click", init));
  return target.localName;
}
