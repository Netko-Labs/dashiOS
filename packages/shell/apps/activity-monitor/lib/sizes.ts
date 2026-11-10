/**
 * The Activity Monitor's window sizes: the size it opens at and the least it
 * may be made. The toolbar's last step fits the least width (toolbar-fit.ts).
 */

import { TOOLBAR_MIN_WIDTH } from "./toolbar-fit.ts";

export const MONITOR_SIZE = { width: 940, height: 640 } as const;
/** The least size: the toolbar's last step in one row, and the summary's one line over a few rows. */
export const MONITOR_MIN_SIZE = { width: TOOLBAR_MIN_WIDTH, height: 360 } as const;
