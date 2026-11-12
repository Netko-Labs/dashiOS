/**
 * The tab in front: its grid of rows (line.tsx), drawn on the terminal's
 * ground, and what sits over it. The margin on the left holds each
 * command's mark from the shell integration: ume for a command that failed,
 * and for any of them a press selects its output. The cursor is drawn in
 * the accent, the letter under a block cursor in the ground's color. A thin
 * bar on the right edge shows where the view is while it is scrolled back;
 * the grid's size shows for a moment while the window is resized; the bell
 * flashes the grid's edge. A tab whose engine went away says so.
 *
 * It reads the screen from the store (store.ts), so a frame re-renders this
 * and the rows that changed, nothing else.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, type KeyDownInfo, type PointerInfo, Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TerminalPalette } from "../palette.ts";
import { cellAt, cellText, type Screen, scrolledBack } from "../screen.ts";
import { type ScreenStore, useScreen } from "../store.ts";
import { LostNote, SizeNote } from "./grid-notes.tsx";
import { type Cell, color, Line, type Look, lookFor } from "./line.tsx";

/**
 * The margin left of the grid, where the marks go, and the same on the
 * right, so text never meets the window's edge; the gap over the grid, and
 * the same under it. The cells' leftover (less than one) adds to the right
 * and the bottom.
 */
export const MARGIN = 12;
export const GRID_TOP = 6;
/** The ground's room around the grid, both sides together: what fitting a grid to the window subtracts. */
export const GRID_INSET = { width: MARGIN * 2, height: GRID_TOP * 2 } as const;
/** A failed command's mark: 3 px wide, inset 2 px from its row's top and bottom. */
const MARK_WIDTH = 3;
const MARK_INSET = 2;
/** Two presses this close (ms) and this near (cells) count as a double click. */
const MULTI_CLICK_MS = 400;
/** How long the grid's size shows after the window stops resizing (ms). */
const SIZE_SHOWN_MS = 1000;
/** How long the bell lights the grid's edge (ms). */
const BELL_MS = 150;

export interface GridProps {
  store: ScreenStore;
  /** The tab in front. */
  id: number;
  cell: Cell;
  palette: TerminalPalette;
  dark: boolean;
  /** Bumped when the bell rings in this tab: the edge flashes. */
  bells: number;
  /** The engine went away: the grid says so (Return starts a new shell, view.tsx). */
  lost: boolean;
  onKeyDown(key: KeyDownInfo): void;
  /** The pointer on a cell: press (with the click count), drag, release. */
  onSelect(phase: PointerInfo["phase"], x: number, y: number, clicks: number): void;
  onWheel(dy: number): void;
  /** A press on the mark on view row `y`: select that command's output. */
  onMark(y: number): void;
  onContextMenu(x: number, y: number): void;
  onLayout(bounds: Bounds): void;
}

export function Grid({ store, id, cell, palette, dark, bells, lost, onKeyDown, onSelect, onWheel, onMark, onContextMenu, onLayout }: GridProps) {
  const colors = useColors();
  const screen = useScreen(store, id);
  // One object while nothing it is made of changes, so the rows' memo holds.
  const look = useMemo(() => lookFor(palette, dark, colors.selection, screen.ink, screen.ground), [palette, dark, colors.selection, screen.ink, screen.ground]);
  const grid = useRef<Bounds | null>(null);
  const lastPress = useRef({ at: 0, x: -1, y: -1, clicks: 0 });
  const size = useShownSize(screen.cols, screen.rows);
  const flashing = useFlash(bells);

  const onPointer = (event: PointerInfo): void => {
    const bounds = event.bounds ?? grid.current;
    if (!bounds) return;
    const at = cellAt(event.x - bounds.x, event.y - bounds.y, cell.width, cell.height, screen.cols, screen.rows);
    let clicks = 1;
    if (event.phase === "down") {
      const last = lastPress.current;
      const now = Date.now();
      clicks = now - last.at < MULTI_CLICK_MS && Math.abs(last.x - at.x) <= 1 && last.y === at.y ? Math.min(last.clicks + 1, 3) : 1;
      lastPress.current = { at: now, x: at.x, y: at.y, clicks };
    }
    onSelect(event.phase, at.x, at.y, clicks);
  };

  return (
    <View
      testID="terminal-ground"
      style={{
        flex: 1,
        backgroundColor: look.ground,
        paddingLeft: MARGIN,
        paddingRight: MARGIN,
        paddingTop: GRID_TOP,
        paddingBottom: GRID_TOP,
        position: "relative",
      }}
      onContextMenu={(event) => onContextMenu(event.x, event.y)}
    >
      <Marks screen={screen} cell={cell} failed={colors.ume} hover={colors.separator} onMark={onMark} />
      <View
        testID="terminal-grid"
        style={{ flex: 1, position: "relative", overflow: "hidden" }}
        onLayout={(bounds) => {
          grid.current = bounds;
          onLayout(bounds);
        }}
        onKeyDown={onKeyDown}
        onWheel={(wheel) => onWheel(wheel.dy)}
        onPointer={onPointer}
      >
        {screen.lines.map((spans, y) => (
          <Line key={y} spans={spans} look={look} cell={cell} />
        ))}
        {/* A lost shell takes no typing: no cursor invites it. */}
        {!lost && <TerminalCursor screen={screen} cell={cell} look={look} />}
      </View>
      {scrolledBack(screen.scroll) && <ScrollBar scroll={screen.scroll} track={screen.rows * cell.height} color={colors.textMuted} />}
      {size !== null && <SizeNote size={size} />}
      {lost && <LostNote />}
      {flashing && (
        <View testID="terminal-bell" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderWidth: 2, borderColor: look.cursor }} />
      )}
    </View>
  );
}

/** The marks in the margin: a failed command's in ume; any of them, pressed, selects its command's output. */
function Marks({ screen, cell, failed, hover, onMark }: { screen: Screen; cell: Cell; failed: string; hover: string; onMark(y: number): void }) {
  return (
    <>
      {screen.marks.map((mark) => (
        <View
          key={mark.y}
          testID={`terminal-mark-${mark.y}`}
          onPress={() => onMark(mark.y)}
          style={{
            position: "absolute",
            left: 0,
            top: GRID_TOP + mark.y * cell.height,
            width: MARGIN,
            height: cell.height,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 3,
            hoverBackgroundColor: hover,
          }}
        >
          {mark.failed && <View style={{ width: MARK_WIDTH, height: cell.height - MARK_INSET * 2, borderRadius: MARK_WIDTH / 2, backgroundColor: failed }} />}
        </View>
      ))}
    </>
  );
}

/**
 * The cursor on its cell, in the accent: a block draws the letter under it in
 * the ground's color, so it is never hidden; a bar, an underline, a hollow box.
 */
function TerminalCursor({ screen, cell, look }: { screen: Screen; cell: Cell; look: Look }) {
  const { cursor } = screen;
  if (!cursor.visible) return null;
  const under = cursor.style === "block" ? cellText(screen.lines[cursor.y] ?? [], cursor.x) : null;
  const wide = under !== null && under.span.w === 2 && Array.from(under.span.s).length === 1;
  const width = cursor.style === "bar" ? 2 : cell.width * (wide ? 2 : 1);
  return (
    <View
      testID="terminal-cursor"
      style={{
        position: "absolute",
        left: (wide && under ? under.span.x : cursor.x) * cell.width,
        top: cursor.y * cell.height + (cursor.style === "underline" ? cell.height - 2 : 0),
        width,
        height: cursor.style === "underline" ? 2 : cell.height,
        alignItems: "center",
        overflow: "hidden",
        ...(cursor.style === "hollow" ? { borderWidth: 1, borderColor: look.cursor } : { backgroundColor: look.cursor }),
      }}
    >
      {under && (
        <View style={{ flexShrink: 0, width: width + cell.width * 2, alignItems: "center" }}>
          <Text
            style={{
              fontFamily: "monospace",
              fontSize: cell.fontSize,
              lineHeight: cell.height,
              color: color(under.span.bg === undefined ? "bg" : under.span.bg, look, look.ground),
              fontWeight: under.span.b ? "bold" : "normal",
              fontStyle: under.span.i ? "italic" : "normal",
            }}
          >
            {under.text}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Where the view is in the scrollback (`track` px tall): a thin bar at the right edge, only while scrolled back. */
function ScrollBar({ scroll, track, color: ink }: { scroll: readonly [number, number, number]; track: number; color: string }) {
  const [total, offset, len] = scroll;
  if (total <= 0 || track <= 0) return null;
  const height = Math.max((len / total) * track, 16);
  const top = Math.min((offset / total) * track, track - height);
  return (
    <View
      testID="terminal-scrollbar"
      style={{ position: "absolute", right: 2, top: GRID_TOP + top, width: 4, height, borderRadius: 2, backgroundColor: ink, opacity: 0.5 }}
    />
  );
}

/** The grid's size ("96×26") for a moment after it changes, not when it first appears. */
function useShownSize(cols: number, rows: number): string | null {
  const [shown, setShown] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (cols === 0) return;
    if (first.current) {
      first.current = false;
      return;
    }
    setShown(`${cols}×${rows}`);
    const timer = setTimeout(() => setShown(null), SIZE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [cols, rows]);
  return shown;
}

/** True for a moment after `bells` changes. */
function useFlash(bells: number): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(bells);
  useEffect(() => {
    if (bells === first.current) return;
    setOn(true);
    const timer = setTimeout(() => setOn(false), BELL_MS);
    return () => clearTimeout(timer);
  }, [bells]);
  return on;
}
