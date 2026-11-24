/** The push button's measures and props (UI-8); the looks are button.tsx and tinted-button.tsx. */

import { SPACE } from "./theme/index.ts";

/** The button's measures (UI-8, design.html "Button"): heights, insets and least widths by look and size. */
export const BUTTON = {
  window: { height: 28, smallHeight: 24, inset: SPACE.button, smallInset: SPACE.inset, least: 84 },
  panel: { height: 36, smallHeight: 28, inset: SPACE.button, smallInset: SPACE.inset, least: 72, edge: 1.5 },
  inks: { height: 28, smallHeight: 26, inset: SPACE.button, smallInset: SPACE.inset, edge: 1, glyph: 11 },
  /** pill-v2's: the card's 24 (12 in, 12 words), the capsule's line 22 (9 in, 11.5 words); a 1 px outline in the words' colour. */
  capsule: { height: 24, smallHeight: 22, inset: SPACE.inset, smallInset: 9, edge: 1, glyph: 8 },
} as const;

export type ButtonSize = "regular" | "small";
export type Look = "window" | "panel";

/**
 * The colours a tinted look draws with, given by the surface it sits on: the inks look's card
 * (the widget area, whose card may be on air or glass) and the capsule's persona (CP-1).
 * `ink` is the words and the outline, `ground` what a secondary one sits on, `edge` its outline,
 * `fill` the one that goes ahead and `onFill` the words on it, `soft` the keys after the words.
 */
export interface ButtonInks {
  ink: string;
  ground: string;
  edge: string;
  fill: string;
  onFill: string;
  soft?: string;
}

export interface ButtonProps {
  label: string;
  onPress: () => void;
  testID: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  isDefault?: boolean;
  /** `small`: 24 tall (28 in the panel look), 12 SemiBold. */
  size?: ButtonSize;
  /** Take the row's width (a sheet's stacked buttons, a card's one action). */
  fill?: boolean;
  /** The panel look: Settings, Control Center, the battery panel, the Installer; the inks look: the widget area; the capsule look: the capsule and its card (UI-8). */
  look?: Look | "inks" | "capsule";
  /** A tinted look's colours (the inks look's default is the Inks' paper and ink by the mode; the capsule's has none). */
  inks?: ButtonInks;
  /** A glyph before the words (glyphs.ts), in the words' colour: a widget's ▶, the capsule's stop square. Tinted looks only. */
  glyph?: string;
  /** Keys that do the same, after the words (the capsule's "Done ⌃❖Space", a conversation's "Yes ↩"); the window and tinted looks. */
  keys?: string;
  /** Keyboard focus is on it (`data-focused`, the gallery's state rows); real keyboard focus is Metal's ring (KB-2). */
  focused?: boolean;
  /** Tab reaches it (KB-1); `false` leaves it to the pointer. A disabled button never takes the keyboard. */
  focusable?: boolean;
  /** What a screen reader says, when the words alone don't name it ("Delete “Groceries”"). */
  accessibilityLabel?: string;
}
