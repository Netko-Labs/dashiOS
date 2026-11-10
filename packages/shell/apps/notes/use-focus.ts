/**
 * Who gets the keyboard next: the search field or the note's body. Each is a
 * counter that changes to hand it over (the field is mounted again, the
 * body's input is focused).
 */

import { useState } from "react";

export interface Focus {
  /** Changes to hand the keyboard to the search field. */
  searching: number;
  search: () => void;
  /** Changes to hand the keyboard to the note, the caret where it was. */
  bodyFocus: number;
  focusBody: () => void;
}

export function useFocus(): Focus {
  const [searching, setSearching] = useState(0);
  const [bodyFocus, setBodyFocus] = useState(0);
  return { searching, search: () => setSearching((n) => n + 1), bodyFocus, focusBody: () => setBodyFocus((n) => n + 1) };
}
