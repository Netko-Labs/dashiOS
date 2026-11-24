/** The page's type sizes (design.html TY-1): the body 13, the title 20, headings 20, 17 and 15. */

import { TYPE } from "@dashi/ui";

export const BODY_SIZE = TYPE.body.size;
export const TITLE_SIZE = TYPE.title.size;
const HEADING_SIZES: readonly number[] = [TYPE.title.size, TYPE.field.size, TYPE.heading.size];

/** The size a heading of `level` is drawn at. */
export const headingSize = (level: number): number => HEADING_SIZES[level - 1] ?? BODY_SIZE;
