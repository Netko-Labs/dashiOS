/**
 * The launcher's live window pictures as state (pictures.ts says the rules):
 * which row they open under and which window is picked, what ← and → are
 * for, and the rects sent to the compositor once the frames are laid out,
 * again only when they change, and none once they fold or the launcher goes.
 */

import { useEffect, useRef, useState } from "react";
import type { LauncherWindow } from "./items.ts";
import type { ArrowsWanted, PictureRect, Pictures } from "./pictures.ts";
import { arrowsWanted, firstShown, openPictures, picturesToSend, rowWindows, STRIP, sameRects, stepPictures } from "./pictures.ts";
import type { Row } from "./row-model.ts";

type Bounds = { x: number; y: number; width: number; height: number };

export interface PicturesInput {
  selectedRow: Row | undefined;
  windows: readonly LauncherWindow[];
  /** The launcher is searching (not the action list or a chip). */
  searching: boolean;
  /** Told what ← and → are for (launcher/keys.ts). */
  arrows?: (want: ArrowsWanted) => void;
  /** Where the pictures go, in the surface's pixels; empty clears them. */
  onPictures?: (rects: PictureRect[]) => void;
}

export interface PicturesState {
  /** The row they show under, or null. */
  rowId: string | null;
  /** The windows drawn now, left to right, and which of them is picked. */
  shown: LauncherWindow[];
  pickedIndex: number;
  picked: LauncherWindow | undefined;
  /** All the row's windows, and the picked one's place among them. */
  count: number;
  at: number;
  /** ← or →; whether it was the pictures'. */
  arrow(to: "left" | "right"): boolean;
  /** Esc: whether there were pictures to fold. */
  fold(): boolean;
  pick(index: number): void;
  layout(window: number, bounds: Bounds): void;
}

export function usePictures({ selectedRow, windows, searching, arrows, onPictures }: PicturesInput): PicturesState {
  const [pictures, setPictures] = useState<Pictures | null>(null);
  const offset = useRef(0);
  const frames = useRef(new Map<number, Bounds>());
  const sent = useRef<PictureRect[] | null>(null);
  const tell = useRef(onPictures);
  tell.current = onPictures;

  const rowWins = searching ? rowWindows(selectedRow, windows) : [];
  const open = searching ? openPictures(pictures, selectedRow?.id ?? null, rowWins.length) : null;
  const first = open ? firstShown(open.at, offset.current, rowWins.length) : 0;
  offset.current = first;
  const shown = open ? rowWins.slice(first, first + STRIP.shown) : [];
  const want = arrowsWanted(open, rowWins.length > 0);

  useEffect(() => arrows?.(want), [arrows, want]);
  // However the launcher goes, ← and → are the field's again and the pictures are cleared.
  useEffect(
    () => () => {
      arrows?.("none");
      if (sent.current && sent.current.length > 0) tell.current?.([]);
      sent.current = null;
    },
    [arrows],
  );

  const send = () => {
    const ids = shown.map((window) => window.id);
    if (ids.length === 0) {
      frames.current.clear();
      if (sent.current && sent.current.length > 0) tell.current?.([]);
      sent.current = [];
      return;
    }
    const rects = picturesToSend(ids, frames.current);
    if (!rects || sameRects(sent.current, rects)) return;
    sent.current = rects;
    tell.current?.(rects);
  };
  const shownKey = shown.map((window) => window.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs when the windows shown change; `send` reads them
  useEffect(send, [shownKey]);

  return {
    rowId: open?.rowId ?? null,
    shown,
    pickedIndex: open ? open.at - first : -1,
    picked: open ? rowWins[open.at] : undefined,
    count: rowWins.length,
    at: open?.at ?? -1,
    arrow: (to) => {
      if (!selectedRow || rowWins.length === 0) return false;
      if (!open) {
        if (to === "left") return false;
        offset.current = 0;
        setPictures({ rowId: selectedRow.id, at: 0 });
        return true;
      }
      setPictures(stepPictures(open, rowWins.length, to === "right" ? 1 : -1));
      return true;
    },
    fold: () => {
      if (!open) return false;
      setPictures(null);
      return true;
    },
    pick: (index) => {
      if (open) setPictures({ rowId: open.rowId, at: first + index });
    },
    layout: (window, bounds) => {
      frames.current.set(window, bounds);
      send();
    },
  };
}
