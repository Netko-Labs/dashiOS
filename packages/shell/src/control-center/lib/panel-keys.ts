/**
 * The Control Center panel's keyboard (panel.tsx): the arrows move between
 * tiles, Space toggles, Return opens, ⇧ and an arrow move a slider, Esc goes
 * back or closes; in edit mode ⌥ and an arrow move the tile, Space resizes
 * it, ⌫ removes it. On a tile's page the keys go to the page instead.
 */

import type { KeyDownInfo } from "@mirinjs/metal";
import { type Direction, stepLevel } from "../../shared/controls/slider-math.ts";
import type { ControlPage } from "../catalog.ts";
import type { Controls } from "../controls.tsx";
import { type Layout, moveToward, neighbor, nextSize, type Placed, removeItem } from "../layout.ts";

const ARROWS: Readonly<Record<string, Direction>> = { left: "left", right: "right", up: "up", down: "down" };

/** What the keys read and change: the panel's state, its tiles, and the page open over it. */
export interface PanelKeys {
  page: ControlPage;
  embedded: boolean;
  /** The layout being edited; null outside edit mode. */
  draft: Layout | null;
  /** The tile the keyboard is on. */
  focus: string | null;
  placed: readonly Placed[];
  controls: Controls;
  pageKey(name: string): void;
  onPage(page: ControlPage): void;
  onClose(): void;
  setDraft(layout: Layout | null): void;
  setFocus(id: string | null): void;
  openPage(id: string, next: ControlPage): void;
}

export function panelKey(keys: PanelKeys, event: KeyDownInfo): void {
  const { page, embedded, draft, focus, placed, controls, setDraft, setFocus, onPage, onClose, openPage } = keys;
  const name = event.key;
  if (name === "escape") {
    if (page !== "main") return onPage("main");
    // Embedded, Esc is Cancel: the edits go and the editor closes.
    if (embedded) {
      setDraft(null);
      return onClose();
    }
    if (draft) return setDraft(null);
    return onClose();
  }
  if (page !== "main") return keys.pageKey(name);
  const direction = ARROWS[name];
  if (direction) {
    if (focus === null) return setFocus(placed[0]?.id ?? null);
    if (draft && event.alt) return setDraft(moveToward(draft, placed, focus, direction));
    if (event.shift && !draft) {
      const level = controls.levelOf(focus);
      if (level !== null) return controls.setLevel(focus, stepLevel(level, direction));
    }
    setFocus(neighbor(placed, focus, direction) ?? focus);
    return;
  }
  if (focus === null) return;
  if (draft) {
    if (name === "space" || name === "enter") setDraft(nextSize(draft, focus, controls.sizesOf(focus)));
    if (name === "backspace" || name === "delete") setDraft(removeItem(draft, focus));
    return;
  }
  if (name === "space") controls.press(focus, (next) => openPage(focus, next));
  if (name === "enter") controls.open(focus, (next) => openPage(focus, next));
}
