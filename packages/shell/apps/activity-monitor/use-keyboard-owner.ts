/**
 * Who has the keyboard in the Activity Monitor's window: the list (its key
 * view, remounted to take it from the field) or the search field (remounted
 * with autoFocus). Each is bumped to hand it over, and again when a sheet or a
 * menu closes.
 */

import { useCallback, useState } from "react";

export interface KeyboardOwner {
  owner: "list" | "field";
  list: number;
  field: number;
}

export interface KeyboardHand {
  focus: KeyboardOwner;
  /** The list takes the keyboard (a row was pressed, or the search field handed it back). */
  toList(): void;
  /** The search field takes the keyboard (its glyph, ❖F). */
  toField(): void;
  /** Whoever had it gets it back: a sheet or menu closed. */
  giveBack(): void;
}

export function useKeyboardOwner(): KeyboardHand {
  // (The person may have clicked into the field meanwhile, so the list's view is remounted on every click of a row.)
  const [focus, setFocus] = useState<KeyboardOwner>({ owner: "list", list: 0, field: 0 });
  const toList = useCallback((): void => setFocus((now) => ({ ...now, owner: "list", list: now.list + 1 })), []);
  const toField = (): void => setFocus((now) => ({ ...now, owner: "field", field: now.field + 1 }));
  const giveBack = (): void => setFocus((now) => (now.owner === "list" ? { ...now, list: now.list + 1 } : { ...now, field: now.field + 1 }));
  return { focus, toList, toField, giveBack };
}
