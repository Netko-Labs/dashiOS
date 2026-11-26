/**
 * Where the split lock puts everything on a screen of any size (LK-1, lock-v3 C and #narrow, decisions.md
 * D803, D806). Three shapes, by the screen's points:
 *
 * - `wide`: landscape, at least `GLASS.lock.wideMin` wide: C's frame (the 264 clock 88 in, who signs in near
 *   the foot, the pills at the foot, Today a 744 pane);
 * - `pane`: landscape and narrower: the clock 30 % of the height (at most 264), who signs in right under it,
 *   the pills at the foot, Today a pane `clamp(W − 600, 400, 744)` wide;
 * - `vertical`: taller than wide: the clock under the status row's band, the pills beside who signs in, Today
 *   a bottom sheet, open when there is room, else its peek.
 *
 * The clock stays hours over minutes everywhere (the owner's narrow answer). The login screen, the other
 * screens and Glance use the same places without Today.
 */

import { GLASS } from "./theme/glass.ts";
import { TYPE } from "./theme/measures.ts";

export type LockShape = "wide" | "pane" | "vertical";

/** Today's place: a full-height pane at the right, or a bottom sheet (open, or its peek). */
export type TodayPlace = { kind: "pane"; width: number; padding: number; top: number; smalls: 2 | 3 } | { kind: "sheet"; open: boolean; width: number };

export interface LockLayout {
  shape: LockShape;
  width: number;
  height: number;
  /** The left half's edge, and the day's top. */
  inset: number;
  top: number;
  clock: { size: number; line: number };
  /** Who signs in: its top from the screen's top. */
  who: { top: number };
  /** The power pills: at the foot of the left half, or beside who signs in at the right. */
  power: { left: number; bottom: number } | { right: number; top: number };
  today: TodayPlace;
  /** Glance's words, where Today is: the pane's left and its middle, or under the left half. */
  glance: { left: number; top: number | null };
}

const { narrow, panes, sheet } = GLASS.lock;

/** Glance's words sit this far under where the sheet's top would be (lock-v3 #narrow). */
const GLANCE_BELOW = 30;

/** The day's line, the gap, hours over minutes: how tall the clock block is at `line`. */
export const clockBlock = (line: number): number => TYPE.body.line + GLASS.lock.dayGap + 2 * line;

/** Who signs in: the initials' row, the gap, the hint. */
export const WHO_HEIGHT = GLASS.lock.initials + GLASS.lock.dayGap + TYPE.secondary.line;

/** The clock a screen `height` tall wears: 30 % of it, at most LK-2's 264, its line 0.82 of its size. */
export function clockFor(height: number): { size: number; line: number } {
  const size = Math.min(GLASS.lock.clock.size, Math.round(narrow.scale * height));
  return size === GLASS.lock.clock.size ? { ...GLASS.lock.clock } : { size, line: Math.round(size * narrow.line) };
}

/** The shape of a screen `width` × `height` (points). */
export function lockShape(width: number, height: number): LockShape {
  if (height > width) return "vertical";
  return width >= GLASS.lock.wideMin ? "wide" : "pane";
}

/** The narrow and vertical edge: 64, 72 from 1280 wide. */
const edgeFor = (width: number): number => (width >= narrow.edgeWideFrom ? narrow.edgeWide : narrow.edge);

/** The narrower pane's width: `clamp(W − 600, 400, 744)` (424 at 1024, 680 at 1280). */
export const paneWidth = (width: number): number => Math.max(panes.min, Math.min(panes.max, width - panes.room));

export function lockLayout(width: number, height: number): LockLayout {
  const shape = lockShape(width, height);
  if (shape === "wide") return wideLayout(width, height);
  return shape === "pane" ? paneLayout(width, height) : verticalLayout(width, height);
}

function wideLayout(width: number, height: number): LockLayout {
  const inset = width >= 1920 ? GLASS.lock.insetWide : GLASS.lock.inset;
  const { pane } = GLASS.lock;
  return {
    shape: "wide",
    width,
    height,
    inset,
    top: GLASS.lock.top,
    clock: { ...GLASS.lock.clock },
    who: { top: height - GLASS.lock.footer },
    power: { left: inset, bottom: GLASS.lock.powerBottom },
    today: { kind: "pane", width: GLASS.lock.today, padding: pane.padding, top: pane.top, smalls: 3 },
    glance: { left: width - GLASS.lock.today + pane.padding, top: null },
  };
}

function paneLayout(width: number, height: number): LockLayout {
  const inset = edgeFor(width);
  const top = narrow.top;
  // The clock shrinks (hours over minutes still) until the left half fits above the foot.
  let clock = clockFor(height);
  const need = (line: number): number => top + clockBlock(line) + narrow.whoGap + WHO_HEIGHT + narrow.whoGap;
  while (need(clock.line) > height && clock.size > 120) clock = { size: clock.size - 2, line: Math.round((clock.size - 2) * narrow.line) };
  const todayWidth = paneWidth(width);
  const inside = todayWidth - 2 * panes.padding;
  return {
    shape: "pane",
    width,
    height,
    inset,
    top,
    clock,
    who: { top: top + clockBlock(clock.line) + narrow.whoGap },
    power: { left: inset, bottom: narrow.powerBottom },
    today: { kind: "pane", width: todayWidth, padding: panes.padding, top: panes.top, smalls: inside >= panes.three ? 3 : 2 },
    glance: { left: width - todayWidth + panes.padding, top: null },
  };
}

function verticalLayout(width: number, height: number): LockLayout {
  const inset = edgeFor(width);
  const top = narrow.topVertical;
  const clock = clockFor(height);
  const whoTop = top + clockBlock(clock.line) + narrow.whoGap;
  // Open when the sheet leaves the left half whole above it.
  const open = height - sheet.open >= whoTop + WHO_HEIGHT + narrow.whoGap;
  const sheetTop = height - (open ? sheet.open : sheet.peek);
  return {
    shape: "vertical",
    width,
    height,
    inset,
    top,
    clock,
    who: { top: whoTop },
    // Level with the initials' row (lock-v3 #narrow: 12 under the row's top).
    power: { right: inset, top: whoTop + (GLASS.lock.initials - GLASS.lock.pill.height) / 2 },
    today: { kind: "sheet", open, width: width - 2 * sheet.inset },
    glance: { left: inset, top: sheetTop + GLANCE_BELOW },
  };
}
