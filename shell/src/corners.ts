/**
 * How round windows are: the one list of choices System Settings offers,
 * settings.json accepts (`appearance.cornerRadius`), agents set
 * (`window_corners`), and the compositor is told as a radius in logical
 * pixels (IPC `chrome {radius}`, 0 to 20). Every window is rounded the same,
 * title bar and app content alike.
 */

export const CORNER_NAMES = ["none", "small", "medium", "large"] as const;
export type CornerName = (typeof CORNER_NAMES)[number];

/** Logical pixels. Medium is what the compositor draws before it is told anything (comp/src/theme.rs). */
export const CORNER_RADIUS: Readonly<Record<CornerName, number>> = { none: 0, small: 8, medium: 12, large: 16 };

export const DEFAULT_CORNERS: CornerName = "medium";

export const isCornerName = (value: unknown): value is CornerName => CORNER_NAMES.some((name) => name === value);
