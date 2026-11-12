/**
 * The launcher's selection, held by row id, never by index: rows that arrive
 * late (files) can't slide another row under it, and Enter acts on the row
 * that is highlighted when it is pressed. A held id that left the list falls
 * back to the first row, which is what a new query selects too.
 */

/** How the keys move it (keys.ts names which keys these are). */
export type Move = "up" | "down" | "page-up" | "page-down" | "first" | "last";

/** Rows a Page Up or Page Down moves by. */
export const PAGE = 5;

/** The id that is highlighted: `held` while it is listed, else the first row. */
export function resolveSelection(ids: readonly string[], held: string | null): string | null {
  return held !== null && ids.includes(held) ? held : (ids[0] ?? null);
}

/** Where `move` takes the selection from `held`. ↑ and ↓ wrap at both ends; pages stop there. */
export function moveSelection(ids: readonly string[], held: string | null, move: Move, page = PAGE): string | null {
  if (ids.length === 0) return null;
  const current = resolveSelection(ids, held);
  const at = current === null ? 0 : ids.indexOf(current);
  const last = ids.length - 1;
  const index = (() => {
    switch (move) {
      case "down":
        return at >= last ? 0 : at + 1;
      case "up":
        return at <= 0 ? last : at - 1;
      case "page-down":
        return Math.min(at + page, last);
      case "page-up":
        return Math.max(at - page, 0);
      case "first":
        return 0;
      case "last":
        return last;
    }
  })();
  return ids[index] ?? null;
}

/** The first row to draw of a long list (All apps) so that row `index` is in the `size` drawn, moving as little as it can from `offset`. */
export function keepInView(index: number, offset: number, size: number, count: number): number {
  if (count <= size) return 0;
  const top = index < offset ? index : index >= offset + size ? index - size + 1 : offset;
  return Math.max(0, Math.min(top, count - size));
}

/**
 * The wheel or touchpad over the list, in lines (mirin's `onWheel`: positive
 * `dy` is toward the start): whole rows to move the selection by (negative is
 * up), and the part of a line kept for the next event, so a touchpad's small
 * steps add up and a long list (All apps) can be scrolled with the pointer.
 */
export function wheelSteps(rest: number, dy: number): { steps: number; rest: number } {
  const total = rest + dy;
  const whole = Math.trunc(total);
  return { steps: -whole, rest: total - whole };
}
