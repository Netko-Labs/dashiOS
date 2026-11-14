/**
 * The card (pill-v2 README, "What the capsule is"): what must be answered or
 * read in full. It wraps, shows the whole message and both buttons, and
 * stands on the Dock. Past its limit there is no Yes: it shows the start,
 * says how much more there is, and "Read it all" opens the text where it
 * lives. Its buttons arm a moment after it opens, so a click meant for what
 * was there before answers nothing.
 */

import { KeySink } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import type { Cell } from "../../shared/pill/index.ts";
import type { OpenCard } from "../types.ts";
import { AMBER, CARD, type CapsuleColours } from "./measures.ts";
import { type CardContent, cardContent } from "./model.ts";
import { Button, Disc, Dots } from "./parts.tsx";

/** What a press or a key on the card comes to. */
export type CardAnswer = { do: "yes" } | { do: "no" } | { do: "choose"; text: string } | { do: "read" } | { do: "close" } | { do: "unfocus" };

export interface CardProps {
  card: OpenCard;
  colours: CapsuleColours;
  /** Dashi's name, or the persona's. */
  name: string;
  /** How the person answers by voice ("the right ❖ key"), or null when they can't. */
  talkKey: string | null;
  /** Dashi listens now: the level, and what it has heard. */
  listening: { text: string } | null;
  level: Pick<Cell<number>, "subscribe" | "getSnapshot">;
  still: boolean;
  now(): number;
  onAnswer(answer: CardAnswer): void;
}

/** The hint under a card: how to answer it, or that it has the keyboard. */
export function hintOf(content: CardContent, card: OpenCard, talkKey: string | null): string {
  if (!content.whole) return "It is too long to answer here.";
  if (content.kind === "reading") return card.keyboard ? "Return closes it." : "";
  if (card.keyboard)
    return content.kind === "permission"
      ? "Return is yes, Esc is no. Any other key gives the keyboard back."
      : "Esc skips it. Any other key gives the keyboard back.";
  if (content.kind === "question") return talkKey ? `Hold ${talkKey} and answer, or type it.` : "";
  return talkKey ? `Press a button, or tap the Dashi key then Return. Or hold ${talkKey} and say yes.` : "Press a button, or tap the Dashi key then Return.";
}

/** Whether the card's buttons are armed yet; turns true by itself when they are. */
function useArmed(armsAt: number, now: () => number): boolean {
  const [armed, setArmed] = useState(() => now() >= armsAt);
  useEffect(() => {
    const wait = armsAt - now();
    if (wait <= 0) return setArmed(true);
    setArmed(false);
    const timer = setTimeout(() => setArmed(true), wait);
    return () => clearTimeout(timer);
  }, [armsAt, now]);
  return armed;
}

function Head({ content, colours, asks }: { content: CardContent; colours: CapsuleColours; asks: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 5 }}>
      <Disc colours={colours} size={CARD.disc} asks={asks} />
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: CARD.headSize + 0.5, fontWeight: "semibold", color: colours.text }}>
          {content.who}
        </Text>
      </View>
      {content.about !== "" && (
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: CARD.headSize, color: colours.soft }}>
            {content.about}
          </Text>
        </View>
      )}
    </View>
  );
}

function Message({ content, colours }: { content: CardContent; colours: CapsuleColours }) {
  return (
    <View
      testID="card-message"
      style={{
        flexDirection: "column",
        gap: 2,
        borderRadius: 8,
        paddingLeft: 9,
        paddingRight: 9,
        paddingTop: 6,
        paddingBottom: 6,
        marginTop: 5,
        marginBottom: 6,
        borderWidth: 1,
        borderColor: colours.soft,
      }}
    >
      {content.lines.map((line, index) => (
        // The lines never reorder.
        <Text key={index} style={{ fontSize: CARD.messageSize, lineHeight: CARD.messageSize * 1.4, color: colours.text }}>
          {line}
        </Text>
      ))}
      {content.more !== "" && (
        <Text style={{ fontSize: CARD.messageSize, lineHeight: CARD.messageSize * 1.4, color: colours.soft }}>{`… ${content.more}`}</Text>
      )}
    </View>
  );
}

function Buttons({ content, armed, colours, onAnswer }: { content: CardContent; armed: boolean; colours: CapsuleColours; onAnswer(answer: CardAnswer): void }) {
  const button = (label: string, answer: CardAnswer, primary = false) => (
    <Button
      key={label}
      label={label}
      primary={primary}
      off={!armed}
      colours={colours}
      measures={CARD.button}
      onPress={() => onAnswer(answer)}
      testID={`card-button:${answer.do}`}
    />
  );
  if (content.kind === "reading") return <>{[!content.whole && button("Read it all", { do: "read" }), button("Close", { do: "close" }, content.whole)]}</>;
  // Past the limit there is no Yes: only reading it whole, where it lives.
  if (!content.whole) return <>{[button(content.kind === "permission" ? "No" : "Skip", { do: "no" }), button("Read it all", { do: "read" }, true)]}</>;
  if (content.kind === "question") return <>{[button("Skip", { do: "no" }), button("Type it", { do: "read" }, content.choices.length === 0)]}</>;
  return <>{[button("No", { do: "no" }), button("Yes, this once", { do: "yes" }, true)]}</>;
}

/** A question's choices, each a press. */
function Choices({
  choices,
  armed,
  colours,
  onAnswer,
}: {
  choices: readonly string[];
  armed: boolean;
  colours: CapsuleColours;
  onAnswer(answer: CardAnswer): void;
}) {
  return choices.map((choice) => (
    <View
      key={choice}
      testID={`card-choice:${choice}`}
      onPress={() => armed && onAnswer({ do: "choose", text: choice })}
      accessibilityRole="button"
      style={{
        height: CARD.choice,
        borderRadius: 8,
        paddingLeft: 9,
        paddingRight: 9,
        marginBottom: 4,
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderColor: colours.text,
        opacity: armed ? 1 : 0.45,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: CARD.fontSize - 1, fontWeight: "semibold", color: colours.text }}>
        {choice}
      </Text>
    </View>
  ));
}

export function Card(props: CardProps) {
  const { card, colours } = props;
  const content = cardContent(card.what, props.name);
  const armed = useArmed(card.armsAt, props.now);
  // Return is yes only as the first key after the card took the keyboard.
  const keys = useRef(0);
  const key = (kind: string): void => {
    const first = keys.current++ === 0;
    if (kind === "escape") return props.onAnswer(content.kind === "reading" ? { do: "close" } : { do: "no" });
    if (kind === "enter" && first && armed && content.whole)
      return props.onAnswer(content.kind === "permission" ? { do: "yes" } : content.kind === "reading" ? { do: "close" } : { do: "unfocus" });
    props.onAnswer({ do: "unfocus" });
  };
  const asks = content.kind !== "reading";
  const hint = hintOf(content, card, props.talkKey);
  return (
    <View
      testID={`card:${content.kind}`}
      accessibilityLabel={[content.who, content.about, content.question, ...content.lines, content.more].filter(Boolean).join(". ")}
      style={{
        flexShrink: 0,
        flexDirection: "column",
        width: CARD.width,
        maxHeight: CARD.maxHeight,
        overflow: "hidden",
        borderRadius: CARD.radius,
        paddingLeft: CARD.paddingX,
        paddingRight: CARD.paddingX,
        paddingTop: CARD.paddingTop,
        paddingBottom: CARD.paddingBottom,
        backgroundColor: colours.fill,
        // With the keyboard it wears the white outline; asking, the amber ring.
        borderWidth: card.keyboard ? 3 : asks ? 2.5 : 1.5,
        borderColor: card.keyboard ? "#ffffff" : asks ? AMBER : colours.rim,
        shadow: "xl",
      }}
    >
      {card.keyboard && <KeySink testID="card-keys" onKey={(input) => key(input.kind)} />}
      <Head content={content} colours={colours} asks={asks} />
      {content.question !== "" && <Text style={{ fontSize: CARD.questionSize, fontWeight: "semibold", color: colours.text }}>{content.question}</Text>}
      <Message content={content} colours={colours} />
      <Choices choices={content.choices} armed={armed} colours={colours} onAnswer={props.onAnswer} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
          {props.listening && <Dots level={props.still ? null : props.level} color={colours.text} />}
          <View testID="card-hint" style={{ flex: 1, minWidth: 0 }}>
            {(props.listening || hint !== "") && (
              <Text style={{ fontSize: CARD.hintSize, lineHeight: CARD.hintSize * 1.35, color: props.listening ? colours.text : colours.soft }}>
                {props.listening ? props.listening.text || "Listening for your answer" : hint}
              </Text>
            )}
          </View>
        </View>
        <Buttons content={content} armed={armed} colours={colours} onAnswer={props.onAnswer} />
      </View>
    </View>
  );
}
