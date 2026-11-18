/**
 * How one card is printed: its paper and words, its ink, and whether it is
 * the card on air (it floods: paper and ink swap, round five #16), whether
 * the house lights are down, and whether it is on the lock screen hiding its
 * private parts. Every part below reads it, so a widget never picks a colour.
 */

import type { InkName, InkTokens } from "@dashi/ui";
import { createContext, useContext } from "react";
import { inkOf } from "../shared/inks/index.ts";

export interface CardLook {
  inks: InkTokens;
  ink: InkName | null;
  /** This card holds the tally: it floods with its ink. */
  air: boolean;
  /** House lights are down (and this card is not on air): its ink is dimmed. */
  houseDown: boolean;
  /** Private nodes are blanks (locked, and not allowed for this one). */
  redact: boolean;
  /** On the lock screen's wash: a translucent paper over the wallpaper, words in the lock's ink. */
  glass?: boolean;
}

export interface CardColours {
  paper: string;
  /** The value's ink: the category's, or plain ink. */
  value: string;
  ink: string;
  secondary: string;
  tertiary: string;
  hairline: string;
  /** Unlit dots. */
  off: string;
  /** A filled button: ink on paper, inverted on a flood. */
  fill: string;
  onFill: string;
}

/** Hex with an alpha byte: "#RRGGBB" and 0–1. */
export const alpha = (hex: string, share: number): string =>
  `${hex.slice(0, 7)}${Math.round(share * 255)
    .toString(16)
    .padStart(2, "0")}`;

export function cardColours(look: CardLook): CardColours {
  const { inks } = look;
  if (look.air) {
    const on = inks.onInk;
    const ground = look.ink ? inks.ink[look.ink] : inks.text.ink;
    return {
      paper: ground,
      value: on,
      ink: on,
      secondary: alpha(on, 0.92),
      tertiary: alpha(on, 0.8),
      hairline: alpha(on, 0.32),
      off: alpha(on, 0.34),
      fill: on,
      onFill: ground,
    };
  }
  const text = inks.text;
  return {
    paper: look.glass ? "#00000047" : inks.paper,
    value: inkOf(inks, look.ink, { down: look.houseDown, onAir: false }),
    ink: text.ink,
    secondary: text.secondary,
    tertiary: text.tertiary,
    hairline: look.glass ? "#FFFFFF33" : text.hairline,
    off: alpha(text.ink, 0.19),
    fill: text.ink,
    onFill: inks.paper,
  };
}

const Look = createContext<CardColours | null>(null);
export const LookProvider = Look.Provider;
const Redact = createContext(false);
export const RedactProvider = Redact.Provider;

/** The card's colours; plain paper and ink outside a card. */
export function useCard(): CardColours {
  const colours = useContext(Look);
  if (!colours) throw new Error("a widget part outside a card");
  return colours;
}

export const useRedacted = (): boolean => useContext(Redact);

/** The lock a redacted card wears in its corner (card.tsx): inset from the card's edges, and its size. */
export const REDACT_LOCK = { inset: 12, size: 11 } as const;
