/** The page's type sizes (design.html TY-1): the body 13, the title 20, headings 20, 17 and 15. */

export const BODY_SIZE = 13;
export const TITLE_SIZE = 20;
const HEADING_SIZES: readonly number[] = [20, 17, 15];

/** The size a heading of `level` is drawn at. */
export const headingSize = (level: number): number => HEADING_SIZES[level - 1] ?? BODY_SIZE;
