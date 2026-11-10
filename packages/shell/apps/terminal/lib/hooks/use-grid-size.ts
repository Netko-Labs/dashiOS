/**
 * The grid's size. Every tab's shell runs at the one grid the window shows,
 * in whole cells of the monospace face: the probe (a row of M's, rendered at
 * the font size) measures a cell, the grid's area on layout gives the columns
 * and rows, and the first tab starts once both are known. Any change to the
 * size is sent to every shell.
 */

import type { Bounds } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { gridFor } from "../screen.ts";
import type { Sessions } from "../sessions.ts";
import { GRID_INSET } from "../views/grid.tsx";
import { type Cell, lineHeightFor } from "../views/line.tsx";

/** The probe's text: its width over ten M's is one cell. */
export const PROBE = "M".repeat(10);

export interface GridSize {
  /** One cell of the face, or null until measured. */
  cell: Cell | null;
  /** The grid's area, on layout: every tab follows it. */
  layoutGrid(area: Bounds): void;
  /** Before the first tab: the area its grid will have, inside the grid's margins. */
  layoutStarting(area: Bounds): void;
  /** The probe's area, on layout: one cell's width at this font size. */
  measure(area: Bounds): void;
}

export interface GridSizeInput {
  sessions: Sessions;
  firstFolder: string | null;
  firstCommand: readonly string[] | null;
  fontSize: number;
}

export function useGridSize({ sessions, firstFolder, firstCommand, fontSize }: GridSizeInput): GridSize {
  const [cell, setCell] = useState<Cell | null>(null);
  const bounds = useRef<Bounds | null>(null);

  // Every tab follows the window's grid; the first starts once the cell is measured.
  const fit = (): void => {
    const area = bounds.current;
    if (!cell || !area) return;
    const { cols, rows } = gridFor(area.width, area.height, cell.width, cell.height);
    const cw = Math.round(cell.width);
    const ch = Math.round(cell.height);
    const was = sessions.size.current;
    if (was?.cols === cols && was.rows === rows && was.cw === cw && was.ch === ch) return;
    sessions.size.current = { cols, rows, cw, ch };
    sessions.broadcast({ t: "resize", cols, rows, cw, ch });
    if (!sessions.started()) sessions.open(firstFolder, firstCommand);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit reads refs; it runs when the cell is measured again.
  useEffect(fit, [cell]);

  return {
    cell,
    layoutGrid(area) {
      bounds.current = area;
      fit();
    },
    layoutStarting(area) {
      bounds.current = { ...area, width: area.width - GRID_INSET.width, height: area.height - GRID_INSET.height };
      fit();
    },
    measure(area) {
      if (area.width <= 0) return;
      const width = area.width / PROBE.length;
      setCell((now) => (now?.fontSize === fontSize && now.width === width ? now : { width, height: lineHeightFor(fontSize), fontSize }));
    },
  };
}
