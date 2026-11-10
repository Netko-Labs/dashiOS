/**
 * The caret and selection, per document: as the input reported it, or where
 * Find or Go to Line moved it.
 */

import type { TextSelection } from "@mirinjs/metal";
import { useState } from "react";
import { lineStart } from "./find.ts";
import type { EditorModel, EditorState } from "./model.ts";

export interface Selection {
  selection: TextSelection;
  select: (start: number, end: number) => void;
  /** Find's next or previous match: shown, scrolled to, and selected (the caret goes there). */
  jump: (step: 1 | -1) => void;
  /** The caret to the start of a line, scrolled to. */
  goToLine: (line: number) => void;
}

export function useSelection(model: EditorModel, state: EditorState): Selection {
  const [selected, setSelected] = useState<TextSelection & { session: number }>({ session: state.session, start: 0, end: 0 });
  const selection = selected.session === state.session ? selected : { start: state.text.length, end: state.text.length };
  const select = (start: number, end: number): void => setSelected({ session: state.session, start, end });
  const jump = (step: 1 | -1): void => {
    if (!model.findNext(step)) return;
    const { find: now } = model.getSnapshot();
    const start = now.matches[now.current] ?? 0;
    select(start, start + now.query.length);
  };
  const goToLine = (line: number): void => {
    const offset = lineStart(state.text, line);
    select(offset, offset);
    model.reveal(offset);
  };
  return { selection, select, jump, goToLine };
}
