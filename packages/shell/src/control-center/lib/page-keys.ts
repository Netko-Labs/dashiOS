/**
 * A tile's page by the keyboard (panel.tsx): ↑ and ↓ move between the rows
 * that can be pressed (the header's switch among them), top to bottom as
 * drawn, and Space or Return presses the one the ring is on. Each row says
 * where it is drawn as it is laid out, so rows that come and go (networks
 * found, a device paired) keep their places in the order. Pure.
 */

/** A row that can be pressed, and how far down the page it is drawn. */
export interface PageStop {
  id: string;
  /** Its top edge as last laid out; a row not laid out yet goes last. */
  y: number | null;
}

/** The stops top to bottom; rows not laid out yet keep their order, after the rest. */
export function pageOrder(stops: readonly PageStop[]): string[] {
  return stops
    .map((stop, index) => ({ ...stop, index }))
    .sort((a, b) => (a.y ?? Number.POSITIVE_INFINITY) - (b.y ?? Number.POSITIVE_INFINITY) || a.index - b.index)
    .map((stop) => stop.id);
}

/**
 * The row ↑ or ↓ goes to: the next one that way, stopping at the ends (as
 * the tiles do); from none (or one that went), ↓ the first and ↑ the last.
 */
export function stepRow(order: readonly string[], current: string | null, direction: "up" | "down"): string | null {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at < 0) return (direction === "down" ? order[0] : order.at(-1)) ?? null;
  const next = direction === "down" ? Math.min(at + 1, order.length - 1) : Math.max(at - 1, 0);
  return order[next] ?? null;
}
