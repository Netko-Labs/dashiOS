/**
 * A PDF's selection, as state: the drag's two ends (held in a ref as well, so
 * a Copy that comes before the window draws them reads them), Select All, and
 * the copy of the text it covers (pdf-copy.ts). A selection asks for the words
 * of its pages, so they are drawn.
 */

import { useRef, useState } from "react";
import { copiedText } from "../pdf/pdf-copy.ts";
import type { Selection } from "../pdf/pdf-selection.ts";
import type { PdfState } from "../snapshot.ts";
import type { Viewer } from "../viewer.ts";
import { turned } from "../zoom.ts";

export interface PdfSelection {
  selection: Selection | null;
  select(selection: Selection | null): void;
  selectAll(): void;
  /** Whether text is selected, as of the latest select (before the window draws it: ❖A then ❖C at once). */
  hasSelection(): boolean;
  /** The selected text, reading pages not read yet. */
  copyText(): Promise<string>;
  /** Nothing selected: a different file, or a click. */
  clear(): void;
}

export function usePdfSelection(viewer: Viewer, pdf: PdfState | null, turns: number): PdfSelection {
  const [selection, setSelectionState] = useState<Selection | null>(null);
  // What is selected as of the latest select, for a Copy that comes before the window draws it.
  const selected = useRef<Selection | null>(null);
  const setSelection = (next: Selection | null): void => {
    selected.current = next;
    setSelectionState(next);
  };

  return {
    selection,
    select: (next) => {
      setSelection(next);
      if (next) {
        viewer.wantText(next.anchor.page);
        if (next.focus.page !== next.anchor.page) viewer.wantText(next.focus.page);
      }
    },
    selectAll: () => {
      if (!pdf) return;
      const last = pdf.sizes[pdf.sizes.length - 1] ?? { width: 0, height: 0 };
      const end = turned(last, turns);
      setSelection({ anchor: { page: 1, x: 0, y: 0 }, focus: { page: pdf.pages, x: end.width, y: end.height } });
      viewer.wantText(1);
      viewer.wantText(pdf.pages);
    },
    hasSelection: () => selected.current !== null,
    copyText: () => copiedText(selected.current, pdf !== null, viewer),
    clear: () => setSelection(null),
  };
}
