/**
 * What the pointer does on a Dock icon after the button goes down, as plain
 * functions of where it is: held still long enough it opens the icon's menu,
 * moved it drags (a pinned icon reorders, and pulled up out of the Dock it is
 * removed), and otherwise it stays a click. The Dock feeds Metal's pointer
 * phases in; none of this touches the screen.
 *
 * Metal keeps reporting a drag after the pointer leaves the Dock's surface
 * (the compositor sends a held pointer to the surface it was pressed on), so
 * an icon is pulled out the way macOS does it, about 60 px up, and the drag
 * ends when the button lifts, wherever the pointer is.
 */

export const GESTURE = {
  /** Holding still this long opens the menu. */
  holdMs: 500,
  /** A press that moves farther than this is a drag, not a click. */
  slop: 5,
  /** Pulled this far above where it went down, an icon is on its way out. */
  pullOut: 60,
} as const;

export interface Press {
  x: number;
  y: number;
  /** The icon's place among the pinned ones; null when it cannot be dragged. */
  from: number | null;
  mode: "press" | "drag" | "moved" | "held";
  /** Where a drag would drop the icon. */
  target: number | null;
  /** Dragged far enough up that dropping it removes it. */
  pulledOut: boolean;
}

export const startPress = (x: number, y: number, from: number | null): Press => ({
  x,
  y,
  from,
  mode: "press",
  target: from,
  pulledOut: false,
});

/** Where an icon that went down at `from` drops when the pointer moved `dx` across, among `count` icons `slot` pixels apart. */
export function reorderIndex(from: number, dx: number, slot: number, count: number): number {
  if (count <= 0 || slot <= 0) return from;
  return Math.min(count - 1, Math.max(0, from + Math.round(dx / slot)));
}

/** `order` with the item at `from` moved to `to`. */
export function moveItem<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/**
 * Where an app drops when its row's items have these centers: dragged by `dx`,
 * it goes after every other item whose center it has passed. Items of unequal
 * width (the taskbar's) need this where equal slots (the Dock's) do not.
 */
export function reorderByCenters(centers: readonly number[], from: number, dx: number): number {
  const center = centers[from];
  if (center === undefined) return from;
  const moved = center + dx;
  return centers.filter((other, index) => index !== from && other < moved).length;
}

/** The press after the pointer moved to (`x`, `y`) among `count` icons `slot` pixels apart; the same object when nothing changed. */
export function movePress(press: Press, x: number, y: number, slot: number, count: number): Press {
  return movePressBy(press, x, y, (from, dx) => reorderIndex(from, dx, slot, count), count);
}

/** `movePress` for a row where `targetOf` says where an item taken at `from` drops after moving `dx` across. */
export function movePressBy(press: Press, x: number, y: number, targetOf: (from: number, dx: number) => number, count: number): Press {
  if (press.mode === "press") {
    if (Math.hypot(x - press.x, y - press.y) <= GESTURE.slop) return press;
    if (press.from === null) return { ...press, mode: "moved" };
    return movePressBy({ ...press, mode: "drag" }, x, y, targetOf, count);
  }
  if (press.mode !== "drag" || press.from === null) return press;
  const target = Math.min(Math.max(count - 1, 0), Math.max(0, targetOf(press.from, x - press.x)));
  const pulledOut = press.y - y >= GESTURE.pullOut;
  return target === press.target && pulledOut === press.pulledOut ? press : { ...press, target, pulledOut };
}

export type Drop = { kind: "none" } | { kind: "remove" } | { kind: "move"; from: number; to: number };

/** What dropping a press does to the pinned icons (nothing, unless it was a drag). */
export function dropOf(press: Press): Drop {
  if (press.mode !== "drag" || press.from === null) return { kind: "none" };
  if (press.pulledOut) return { kind: "remove" };
  return press.target === null || press.target === press.from ? { kind: "none" } : { kind: "move", from: press.from, to: press.target };
}

/** The hold timer ran out: a press that has not moved becomes a held one. */
export const holdPress = (press: Press): Press => (press.mode === "press" ? { ...press, mode: "held" } : press);

/** Whether a click that arrives with this press should be ignored (it was a drag or a hold, not a click). */
export const swallowsClick = (press: Press): boolean => press.mode !== "press";
