/**
 * How one card is printed: its paper and words, its ink, and whether it is
 * the card on air, whether the house lights are down, and whether it is on
 * the lock screen hiding its private parts. Every part below reads it, so a
 * widget never picks a colour. On air the card keeps its paper and words and
 * glows in its own ink (CO-12, D768: `onAirGlow`), on the lock too (D807).
 */

import { GLASS, type InkName, type InkTokens, withAlpha } from "@dashi/ui";
import { createContext, useContext } from "react";
import { inkOf } from "../shared/inks/index.ts";

export interface CardLook {
  inks: InkTokens;
  ink: InkName | null;
  /** This card holds the tally: it glows in its ink. */
  air: boolean;
  /** House lights are down (and this card is not on air): its ink is dimmed. */
  houseDown: boolean;
  /** Private nodes are blanks (locked, and not allowed for this one). */
  redact: boolean;
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
  /** A filled button: ink on paper. */
  fill: string;
  onFill: string;
}

/** Hex with an alpha byte: "#RRGGBB" and 0–1. */
export const alpha = (hex: string, share: number): string =>
  `${hex.slice(0, 7)}${Math.round(share * 255)
    .toString(16)
    .padStart(2, "0")}`;

/**
 * The glow of a card on air (CO-12, `GLASS.onAir`): a shadow `0 0 30 3` in its own ink (plain ink for a
 * widget printed in plain ink), at 60 % in Light and 55 % in Dark. Nothing off air.
 */
export function onAirGlow(look: CardLook): string | null {
  if (!look.air) return null;
  const { inks } = look;
  const ink = look.ink ? inks.ink[look.ink] : inks.text.ink;
  const { blur, spread } = GLASS.onAir;
  return `0 0 ${blur} ${spread} ${withAlpha(ink, GLASS.onAir[inks.mode])}`;
}

export function cardColours(look: CardLook): CardColours {
  const { inks } = look;
  const text = inks.text;
  return {
    paper: inks.paper,
    value: inkOf(inks, look.ink, { down: look.houseDown, onAir: look.air }),
    ink: text.ink,
    secondary: text.secondary,
    tertiary: text.tertiary,
    hairline: text.hairline,
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
