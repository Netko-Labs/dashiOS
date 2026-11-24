/**
 * The surface a shell sheet with no window is drawn on (the power sheets,
 * polkit, the Wi-Fi password, Bluetooth pairing, Change Password): the kit's
 * sheet card (`AlertSheet` or `FormSheet` with `place="screen"`, UI-5) and the
 * room its shadow needs on each side.
 */

import { SPACE } from "@dashi/ui";

/** The card's width, and the room around it for its `xl` shadow. */
export const SHEET_SIZE = { width: 380, margin: SPACE.xl + SPACE.xs } as const;

/** The surface's width for a sheet `width` wide. */
export const sheetSurfaceWidth = (width: number = SHEET_SIZE.width): number => width + 2 * SHEET_SIZE.margin;
