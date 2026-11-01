/**
 * Dragging screens in the arrangement view. A screen dropped near another
 * snaps its edge against it (and its top, bottom, or middle against the
 * other's); it never overlaps, and it always touches an edge of another so
 * the pointer can cross. Positions are in points, the space the compositor
 * lays out in. The compositor enforces the same rules when it places
 * screens (comp/src/outputs/place.rs); this is what the view shows while
 * dragging, so that what is dropped is what is applied.
 */

export interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Spot {
  x: number;
  y: number;
}

/** How far a screen's edge has to be from another's to jump onto it, in points. */
export const SNAP_DISTANCE = 120;
/** The least stretch of edge two screens must share, so the pointer has a way across. */
const MIN_SHARED = 80;

const right = (box: Box): number => box.x + box.width;
const bottom = (box: Box): number => box.y + box.height;

/** Sharing area; touching edges do not count. */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

/** Sharing a stretch of edge. */
export function touches(a: Box, b: Box): boolean {
  const acrossX = a.y < bottom(b) && b.y < bottom(a);
  const acrossY = a.x < right(b) && b.x < right(a);
  return ((right(a) === b.x || right(b) === a.x) && acrossX) || ((bottom(a) === b.y || bottom(b) === a.y) && acrossY);
}

/** Whether every screen can be reached from every other across touching edges. */
export function isConnected(boxes: readonly Box[]): boolean {
  if (boxes.length < 2) return true;
  const reached = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const at = boxes[queue.pop() as number] as Box;
    boxes.forEach((other, index) => {
      if (!reached.has(index) && touches(at, other)) {
        reached.add(index);
        queue.push(index);
      }
    });
  }
  return reached.size === boxes.length;
}

/** `value` pulled to the nearest of `targets` that lies within `distance`, else itself. */
function pull(value: number, targets: readonly number[], distance: number): number {
  let best = value;
  let least = distance + 1;
  for (const target of targets) {
    const gap = Math.abs(target - value);
    if (gap < least) {
      least = gap;
      best = target;
    }
  }
  return best;
}

/**
 * Where `moving` lands when dropped with its top-left corner at `wanted`:
 * against the edge of one of `others` (the nearest spot that overlaps none
 * of them), its top, bottom, or middle lined up with theirs when close.
 * `others` empty: anywhere.
 */
export function snapDrag(moving: Box, others: readonly Box[], wanted: Spot, distance: number = SNAP_DISTANCE): Spot {
  if (others.length === 0) return { x: Math.round(wanted.x), y: Math.round(wanted.y) };
  const w = moving.width;
  const h = moving.height;
  const candidates: Spot[] = [];
  for (const other of others) {
    const share = Math.min(MIN_SHARED, other.width, other.height, w, h);
    // Along an edge: free between "just touches at the near end" and "just touches at the far end".
    const alongY = Math.min(Math.max(wanted.y, other.y - h + share), bottom(other) - share);
    const alongX = Math.min(Math.max(wanted.x, other.x - w + share), right(other) - share);
    const rows = [pull(alongY, [other.y, bottom(other) - h, other.y + (other.height - h) / 2], distance)];
    const columns = [pull(alongX, [other.x, right(other) - w, other.x + (other.width - w) / 2], distance)];
    for (const y of rows) {
      candidates.push({ x: right(other), y }, { x: other.x - w, y });
    }
    for (const x of columns) {
      candidates.push({ x, y: bottom(other) }, { x, y: other.y - h });
    }
  }
  const free = candidates.filter((spot) => others.every((other) => !overlaps({ ...moving, ...spot }, other)));
  const pool = free.length > 0 ? free : candidates;
  const cost = (spot: Spot): number => Math.hypot(spot.x - wanted.x, spot.y - wanted.y);
  const best = pool.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  return { x: Math.round(best.x), y: Math.round(best.y) };
}

/** The boxes moved so the top-left of all of them is the origin. */
export function normalized<T extends Box>(boxes: readonly T[]): T[] {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  return boxes.map((box) => ({ ...box, x: box.x - left, y: box.y - top }));
}

export interface View {
  scale: number;
  /** Where the arrangement's origin sits in the view. */
  originX: number;
  originY: number;
}

/**
 * How to draw `boxes` inside a view of this size so all fit, centered, with
 * room around them to drag a screen to any side. The scale never grows past `maxScale`.
 */
export function fitView(boxes: readonly Box[], width: number, height: number, margin: number, maxScale = 0.25): View {
  if (boxes.length === 0) return { scale: maxScale, originX: 0, originY: 0 };
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const spanX = Math.max(...boxes.map(right)) - left;
  const spanY = Math.max(...boxes.map(bottom)) - top;
  // Room for one more screen's worth on each side, as dragged ones can go there.
  const padX = Math.max(...boxes.map((box) => box.width)) * 0.35;
  const padY = Math.max(...boxes.map((box) => box.height)) * 0.35;
  const scale = Math.min(maxScale, (width - 2 * margin) / (spanX + 2 * padX), (height - 2 * margin) / (spanY + 2 * padY));
  return {
    scale,
    originX: (width - spanX * scale) / 2 - left * scale,
    originY: (height - spanY * scale) / 2 - top * scale,
  };
}

/** What is dragged: which screen, where it started, and where it would land now. */
export interface Drag {
  name: string;
  /** The grab point inside the screen, in points. */
  offsetX: number;
  offsetY: number;
  start: Spot;
  spot: Spot;
}

/** A point in the view (pixels) as a point in the arrangement. */
export function toPoints(view: View, pixel: Spot): Spot {
  return { x: (pixel.x - view.originX) / view.scale, y: (pixel.y - view.originY) / view.scale };
}

/** The screen under `pixel` in the view, the last drawn on top; null if none. */
export function boxAt(boxes: readonly Box[], view: View, pixel: Spot): Box | null {
  const at = toPoints(view, pixel);
  return [...boxes].reverse().find((box) => at.x >= box.x && at.x < right(box) && at.y >= box.y && at.y < bottom(box)) ?? null;
}

/** Pick up the screen under `pixel`. */
export function beginDrag(boxes: readonly Box[], view: View, pixel: Spot): Drag | null {
  const box = boxAt(boxes, view, pixel);
  if (!box) return null;
  const at = toPoints(view, pixel);
  return { name: box.name, offsetX: at.x - box.x, offsetY: at.y - box.y, start: { x: box.x, y: box.y }, spot: { x: box.x, y: box.y } };
}

/** Where the dragged screen would land with the pointer at `pixel`. */
export function moveDrag(drag: Drag, boxes: readonly Box[], view: View, pixel: Spot): Drag {
  const moving = boxes.find((box) => box.name === drag.name);
  if (!moving) return drag;
  const at = toPoints(view, pixel);
  const spot = snapDrag(moving, boxes.filter((box) => box.name !== drag.name), { x: at.x - drag.offsetX, y: at.y - drag.offsetY }, SNAP_DISTANCE);
  return { ...drag, spot };
}

/** Where to put the screen when dropped, or null when it did not move. */
export function dropSpot(drag: Drag): Spot | null {
  return drag.spot.x === drag.start.x && drag.spot.y === drag.start.y ? null : drag.spot;
}
