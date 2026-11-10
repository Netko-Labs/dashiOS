/**
 * The Calculator's state and what it remembers: the reducer (state.ts), the
 * timers that fade a lit key and the word under the line, the rewriting of
 * the line when the number region changes, and the saving of the tape,
 * whether it shows and the window's size (store.ts) once the window has
 * stopped changing size.
 */

import { type Dispatch, type SetStateAction, useEffect, useReducer, useRef, useState } from "react";
import type { Size } from "../kit/index.ts";
import { openingSize } from "./layout.ts";
import type { NumberLocale } from "./locale.ts";
import { type CalcAction, type CalcState, calculate, initialState } from "./state.ts";
import type { Remembered } from "./store.ts";

/** How long a key the keyboard typed stays lit. */
const LIT_MS = 120;
/** How long a word under the line ("Copied") stays. */
const NOTICE_MS = 2000;
/** Saving waits for the window to stop changing size. */
const SAVE_MS = 400;

export interface CalculatorState {
  state: CalcState;
  dispatch: Dispatch<CalcAction>;
  showsTape: boolean;
  setShowsTape: Dispatch<SetStateAction<boolean>>;
  size: Size;
  setSize: Dispatch<SetStateAction<Size>>;
}

export function useCalculatorState(remembered: Remembered, locale: NumberLocale, remember: (remembered: Remembered) => void): CalculatorState {
  const [state, dispatch] = useReducer(calculate, remembered.tape, initialState);
  const [showsTape, setShowsTape] = useState(remembered.showsTape);
  // What the window opened at, until the window says (the root's layout, on every change).
  const [size, setSize] = useState<Size>(() => openingSize(remembered.size, remembered.showsTape));

  useEffect(() => {
    if (state.lit === null) return;
    const timer = setTimeout(() => dispatch({ type: "unlit" }), LIT_MS);
    return () => clearTimeout(timer);
  }, [state.lit]);
  useEffect(() => {
    if (state.notice === null) return;
    const timer = setTimeout(() => dispatch({ type: "notice", notice: null }), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [state.notice]);
  // The region changed: the line is rewritten in its marks, or "1.250" would read as 1.25.
  const shownIn = useRef(locale);
  useEffect(() => {
    if (shownIn.current === locale) return;
    dispatch({ type: "relocale", from: shownIn.current, to: locale });
    shownIn.current = locale;
  }, [locale]);
  const saved = useRef<string | null>(null);
  useEffect(() => {
    const next: Remembered = { tape: state.tape, showsTape, size };
    const key = JSON.stringify(next);
    if (saved.current === null) {
      // What was just read needs no writing back.
      saved.current = JSON.stringify(remembered);
    }
    if (key === saved.current) return;
    const timer = setTimeout(() => {
      saved.current = key;
      remember(next);
    }, SAVE_MS);
    return () => clearTimeout(timer);
  }, [state.tape, showsTape, size, remember, remembered]);

  return { state, dispatch, showsTape, setShowsTape, size, setSize };
}
