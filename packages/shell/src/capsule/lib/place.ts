/**
 * Where the capsule sits (pill-v2 README, "Where it sits"): home is the
 * bottom centre, just above the Dock. When a window fills or tiles down to
 * the Dock (the capsule would lie on its last lines) it goes into the Dock's row, beside the Dock, on the side of the window
 * that has the keyboard. With no room there (a taskbar, a full Dock) it goes
 * one step up; with no Dock, against the edge, or a step up from it when a
 * window is there. A card always stands on the Dock, centred.
 */

import type { DockPlace } from "../../dock/index.ts";
import { DOCK, DOCK_HEIGHT, TASKBAR } from "../../theme.ts";
import type { Place } from "../types.ts";
import { CAPSULE, CARD, SEAT } from "./measures.ts";

/** A window, as the place needs it: its frame on the capsule's screen, and whether it has the keyboard. */
export interface PlacedWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
}

export interface PlaceInput {
  dock: DockPlace | null;
  /** The capsule's screen: its frame, and the area windows may use. */
  screen: { x: number; y: number; width: number; height: number };
  usable: { x: number; y: number; width: number; height: number };
  /** The windows showing on that screen. */
  windows: readonly PlacedWindow[];
}

/** The Dock's top, from the screen's bottom edge; 0 with no Dock on screen. */
export function dockTop(dock: DockPlace | null): number {
  if (!dock?.shown) return 0;
  return dock.style === "taskbar" ? TASKBAR.height : DOCK_HEIGHT + DOCK.margin;
}

const home = (dock: DockPlace | null): Place => ({
  seat: "home",
  bottom: dockTop(dock) + SEAT.aboveDock,
  at: { centre: true },
  maxWidth: CAPSULE.maxWidth,
  tail: CAPSULE.tail,
});

/**
 * Whether the capsule at `bottom` (from the screen's bottom edge) would lie
 * on `window`: the window comes down past the capsule's top, and lies under
 * the middle of the screen. A window that fills or tiles down to the Dock
 * does; one floating higher up does not.
 */
function under(window: PlacedWindow, bottom: number, input: PlaceInput): boolean {
  const edge = input.screen.y + input.screen.height;
  const top = edge - bottom - CAPSULE.height;
  if (window.y + window.height < top + OVERLAP || window.y > edge - bottom - OVERLAP) return false;
  const centre = input.screen.x + input.screen.width / 2;
  return window.x < centre + CAPSULE.maxWidth / 4 && window.x + window.width > centre - CAPSULE.maxWidth / 4;
}
/** This much of the capsule over a window is on it. */
const OVERLAP = 4;

export function placeOf(input: PlaceInput): Place {
  const { dock, screen } = input;
  const rest = dock?.shown ? home(dock).bottom : SEAT.edge;
  const filling = input.windows.filter((window) => under(window, rest, input));
  const up = { at: { centre: true } as const, maxWidth: CAPSULE.maxWidth, tail: CAPSULE.tail };
  if (!dock?.shown) return filling.length > 0 ? { seat: "edge-up", bottom: SEAT.edgeUp, ...up } : { seat: "edge", bottom: SEAT.edge, ...up };
  if (filling.length === 0) return home(dock);
  const step: Place = { seat: "up", bottom: dockTop(dock) + SEAT.aboveDock + SEAT.step, ...up };
  if (dock.style === "taskbar" || !dock.panel) return step;
  const roomRight = screen.width - (dock.panel.x + dock.panel.width) - SEAT.beside * 2;
  const roomLeft = dock.panel.x - SEAT.beside * 2;
  // The side of the window that has the keyboard; a window across both sides, the right.
  const own = filling.find((window) => window.focused) ?? filling[0];
  const centre = own ? own.x + own.width / 2 - screen.x : screen.width;
  const side = centre < screen.width / 2 - 1 && roomLeft >= SEAT.least ? "left" : "right";
  const room = side === "left" ? roomLeft : roomRight;
  if (room < SEAT.least) return step;
  const maxWidth = Math.min(CAPSULE.seatMaxWidth, room);
  const tail = Math.min(CAPSULE.seatTail, maxWidth - 80);
  return side === "left"
    ? { seat: "left", bottom: SEAT.row, at: { right: screen.width - dock.panel.x + SEAT.beside }, maxWidth, tail }
    : { seat: "right", bottom: SEAT.row, at: { left: dock.panel.x + dock.panel.width + SEAT.beside }, maxWidth, tail };
}

/** A card's bottom edge: on the Dock (it comes out for as long as the card asks), a little over its top; against the edge with none. */
export function cardBottom(dock: DockPlace | null, dockVisible: boolean): number {
  if (!dockVisible || !dock) return SEAT.edge;
  return (dock.style === "taskbar" ? TASKBAR.height : DOCK_HEIGHT + DOCK.margin) - CARD.onDock;
}

/** How high the capsule or card reaches from the bottom edge: the small volume indicator sits above it. */
export const topOf = (bottom: number, height: number): number => bottom + height;
