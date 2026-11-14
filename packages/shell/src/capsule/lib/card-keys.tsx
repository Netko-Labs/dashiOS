/**
 * The card's keys. The card is drawn on the capsule's surface, which never
 * takes the keyboard; a tap of the Dashi key opens this second surface over
 * it, which draws nothing, takes no pointer and has the keyboard. So the
 * card stays where it is while the keyboard comes (a layer surface's
 * keyboard is fixed when it opens: reopening the card's own made it blink
 * away for a second, and a Return pressed meanwhile was lost).
 */

import { KeySink } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useRef, useSyncExternalStore } from "react";
import type { Cell } from "../../shared/pill/index.ts";
import type { OpenCard } from "../types.ts";
import type { CardAnswer } from "./card.tsx";
import { type CardContent, cardContent } from "./model.ts";
import { cardId } from "./sources.ts";

/** The key surface's layer: `input-origin` there says the person pressed Return. */
export const KEYS_LAYER = "dashi.capsule.keys";

/**
 * What a key comes to: Return is yes only as the first key after the card took the keyboard (or was scrolled), armed and
 * with its end shown; before the end it reads on; Esc is no; anything else gives the keyboard back.
 */
export function cardKey(kind: string, first: boolean, armed: boolean, content: Pick<CardContent, "kind" | "whole" | "end">): CardAnswer {
  if (kind === "escape") return content.kind === "reading" ? { do: "close" } : { do: "no" };
  if (kind === "enter" && first && armed && !content.end) return { do: "read" };
  if (kind === "enter" && first && armed && content.whole)
    return content.kind === "permission" ? { do: "yes" } : content.kind === "reading" ? { do: "close" } : { do: "unfocus" };
  return { do: "unfocus" };
}

export interface CardKeysProps {
  /** The card that has the keyboard, told once the key surface's window is open. */
  card: Pick<Cell<OpenCard | null>, "subscribe" | "getSnapshot">;
  now(): number;
  onAnswer(answer: CardAnswer): void;
}

function Sink({ card, now, onAnswer }: { card: OpenCard; now(): number; onAnswer(answer: CardAnswer): void }) {
  // Keys counted since this card took the keyboard.
  const keys = useRef(0);
  return (
    <KeySink
      testID="card-keys"
      onKey={(input) => onAnswer(cardKey(input.kind, keys.current++ === 0, now() >= card.armsAt, cardContent(card.what, "", card.from)))}
    />
  );
}

/**
 * What the key surface draws: nothing, and a key sink while a card has the
 * keyboard. The sink appears after the window opened: a new sink gives the
 * keyboard to its window (@dashi/ui `KeySink`), and one that appears before
 * there is a window hears nothing.
 */
export function CardKeys({ card: cell, now, onAnswer }: CardKeysProps) {
  const card = useSyncExternalStore(cell.subscribe, cell.getSnapshot);
  return <View style={{ flex: 1 }}>{card && <Sink key={`${cardId(card)}:${card.from}`} card={card} now={now} onAnswer={onAnswer} />}</View>;
}
