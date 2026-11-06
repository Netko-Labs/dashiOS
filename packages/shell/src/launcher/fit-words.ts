/**
 * Words the field shows whole or not at all (a placeholder never reads
 * "Follow up with Cl…"): the fullest choice whose drawn width fits the room
 * the field has, both measured where they are drawn (field.tsx), never
 * guessed from a letter count. Until both are known, the last choice, the
 * shortest, which is written to fit at every text size. Pure.
 */

/** The caret and the field's own inset, kept free before the placeholder. */
export const PLACEHOLDER_SLACK = 8;

/** The key a width is kept under: the same words at the same size draw the same. */
export const widthKey = (text: string, fontSize: number): string => `${fontSize}:${text}`;

/** The fullest of `choices` (fullest first) that fits `room`, by the measured `widthOf`; the last when nothing is known yet. */
export function fitWords(choices: readonly string[], room: number | null, widthOf: (text: string) => number | undefined): string {
  const last = choices[choices.length - 1] ?? "";
  if (room === null) return last;
  for (const choice of choices.slice(0, -1)) {
    const width = widthOf(choice);
    if (width !== undefined && width + PLACEHOLDER_SLACK <= room) return choice;
  }
  return last;
}

/** The choices still to measure, the last too: the field keeps room for it whatever else is in the row (field.tsx). */
export const unmeasured = (choices: readonly string[], widthOf: (text: string) => number | undefined): string[] =>
  choices.filter((choice) => widthOf(choice) === undefined);

/** The least room the field keeps: the last choice whole, once it is measured. */
export function leastRoom(choices: readonly string[], widthOf: (text: string) => number | undefined): number {
  const last = choices.length > 1 ? widthOf(choices[choices.length - 1] ?? "") : undefined;
  return last === undefined ? 0 : Math.ceil(last + PLACEHOLDER_SLACK);
}
