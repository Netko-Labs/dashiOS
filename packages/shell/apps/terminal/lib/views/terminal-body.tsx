/**
 * The Terminal's body: the front tab's grid (grid.tsx), in the palette, with
 * its input routed to the engine, or the starting area before the first tab.
 * Behind them a hidden probe measures one cell of the monospace face at the
 * font size (use-grid-size.ts), so the grid knows its columns and rows.
 */

import { type KeyDownInfo, Text, View } from "@mirinjs/metal";
import type { EngineInput } from "../engine.ts";
import { type GridSize, PROBE } from "../hooks/use-grid-size.ts";
import type { TerminalPalette } from "../palette.ts";
import type { ScreenStore } from "../store.ts";
import type { Tab } from "../tabs.ts";
import { Grid } from "./grid.tsx";
import { lineHeightFor } from "./line.tsx";

export interface TerminalBodyProps {
  front: Tab | undefined;
  store: ScreenStore;
  grid: GridSize;
  palette: TerminalPalette;
  dark: boolean;
  bells: number;
  /** Bumped when a sheet goes: the grid is mounted again and takes the keyboard. */
  gridFocus: number;
  fontSize: number;
  onKeyDown(key: KeyDownInfo): void;
  /** Sends to the front tab's engine. */
  send(input: EngineInput): void;
  onContextMenu(x: number, y: number): void;
}

export function TerminalBody({ front, store, grid, palette, dark, bells, gridFocus, fontSize, onKeyDown, send, onContextMenu }: TerminalBodyProps) {
  return (
    <>
      {front && grid.cell ? (
        <Grid
          key={`grid:${gridFocus}:${front.id}`}
          store={store}
          id={front.id}
          cell={grid.cell}
          palette={palette}
          dark={dark}
          bells={bells}
          lost={front.lost}
          onKeyDown={onKeyDown}
          onSelect={(phase, x, y, clicks) => send({ t: "select", phase, x, y, clicks })}
          // A wheel's notch is a whole line: three, as everywhere; a touchpad's fractions go as they come.
          onWheel={(dy) => send({ t: "scroll", lines: Number.isInteger(dy) ? dy * 3 : dy })}
          onMark={(y) => send({ t: "select-output", y })}
          onContextMenu={onContextMenu}
          onLayout={grid.layoutGrid}
        />
      ) : (
        // Before the first tab: the area its grid will have, inside the grid's margins.
        <View testID="terminal-starting" style={{ flex: 1, backgroundColor: palette.ground }} onLayout={grid.layoutStarting} />
      )}
      {/* Measures one cell of the monospace face, again at each size. */}
      <View style={{ position: "absolute", left: 0, top: -200, width: 4000, flexDirection: "row", opacity: 0 }}>
        <View key={fontSize} testID="terminal-probe" style={{ flexShrink: 0 }} onLayout={grid.measure}>
          <Text style={{ fontFamily: "monospace", fontSize, lineHeight: lineHeightFor(fontSize) }}>{PROBE}</Text>
        </View>
      </View>
    </>
  );
}
