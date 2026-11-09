/**
 * A pill row with more than five choices folds (docs/design.html,
 * "Settings", SE-5): it shows the four commonest and a "More" pill, which
 * opens the whole list. The value in use is always in sight: when it is one
 * of the hidden choices, it takes the fourth pill's place, chosen.
 */

export interface Choice<T> {
  value: T;
  label: string;
}

/** A row folds past this many choices. */
export const FOLD_PAST = 5;
/** How many pills a folded row shows before "More". */
export const FOLDED_PILLS = 4;

export interface Folded<T> {
  /** The pills, in the list's order but for a hidden value, which stands fourth. */
  shown: Array<Choice<T>>;
  /** Whether "More" follows them (the list has others). */
  more: boolean;
}

/**
 * The pills a row shows for `value`. `common` names the commonest choices
 * (the first four by default); with five or fewer choices, every one shows.
 */
export function foldChoices<T>(options: ReadonlyArray<Choice<T>>, value: T, common?: readonly T[]): Folded<T> {
  if (options.length <= FOLD_PAST) return { shown: [...options], more: false };
  const named = common ? options.filter((option) => common.includes(option.value)) : [];
  const usual = (named.length > 0 ? named : options).slice(0, FOLDED_PILLS);
  const current = options.find((option) => option.value === value);
  if (!current || usual.some((option) => option.value === value)) return { shown: usual, more: true };
  return { shown: [...usual.slice(0, FOLDED_PILLS - 1), current], more: true };
}

/** The menu clears the pills' track (4 of padding) by 4. */
const BELOW_TRACK = 4 + 4;

/**
 * Where "More"'s menu hangs for the pill at `pill`: under the track, its
 * right edge under the pill's (`PopupMenu`'s `anchor` "end"), as every
 * "More" menu hangs. The pill ends the row, so a menu opened at its left
 * would run off the window and flip away from it. `PopupMenu` keeps it in
 * the window.
 */
export function moreMenuOrigin(pill: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: Math.round(pill.x + pill.width), y: Math.round(pill.y + pill.height + BELOW_TRACK) };
}
