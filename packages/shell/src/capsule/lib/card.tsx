/**
 * The card (pill-v2 README, "What the capsule is"): what must be answered or
 * read in full. It wraps, shows the whole message and both buttons, and
 * stands on the Dock. Past its limit there is no Yes: it shows the start,
 * says how much more there is, and "Read it all" scrolls it in place, a view
 * at a time; Yes comes back once the end has been shown (decisions.md D82).
 * Its buttons arm a moment after it opens and after each scroll, so a click
 * meant for what was there before answers nothing.
 * It is regular glass (CP-11, D766): the persona's colour is its 1.5 rim, which
 * the 3-point purple focus rim replaces while it has the keyboard; its words
 * are the glass's inks, its choices on fills, the yes filled in ink. Only the
 * line under it (line.tsx) stays solid.
 */

import { Frosted, KeyedText, Button as KitButton, type Palette, RADIUS, SHADOW, SPACE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { type Cell, STOP_KEYS } from "../../shared/pill/index.ts";
import type { OpenCard } from "../types.ts";
import { CARD, type CapsuleColours } from "./measures.ts";
import { type CardContent, cardContent } from "./model.ts";
import { Button, buttonInks, Disc, Dots } from "./parts.tsx";

/** What a press or a key on the card comes to. */
export type CardAnswer = { do: "yes" } | { do: "no" } | { do: "choose"; text: string } | { do: "read" } | { do: "close" } | { do: "unfocus" };

export interface CardProps {
  card: OpenCard;
  colours: CapsuleColours;
  /** The persona's own colour: the card's rim (CP-11). Its disc wears `colours.fill`, darkened for its white mark. */
  personaColour: string;
  /** Dashi's name, or the persona's. */
  name: string;
  /** How the person answers by voice ("the right ❖ key"), or null when they can't. */
  talkKey: string | null;
  /** Dashi listens now: the level, and what it has heard. */
  listening: { text: string } | null;
  /** Dashi's voice while the card is up: it speaks, or ❖Esc just stopped it. */
  voice?: "speaking" | "stopped" | undefined;
  level: Pick<Cell<number>, "subscribe" | "getSnapshot">;
  still: boolean;
  now(): number;
  onAnswer(answer: CardAnswer): void;
}

/** The hint under a card: how to answer it, or that it has the keyboard. */
export function hintOf(content: CardContent, card: OpenCard, talkKey: string | null): string {
  if (!content.end)
    return card.keyboard ? "Return reads on. Esc closes it." : content.kind === "reading" ? "There is more than fits here." : "Read it all to answer.";
  if (content.kind === "reading") return card.keyboard ? "Return closes it." : "";
  if (!content.whole) return "It has too many choices to answer here.";
  if (card.keyboard)
    return content.kind === "permission"
      ? "Return is yes, Esc is no. Any other key gives the keyboard back."
      : "Esc skips it. Any other key gives the keyboard back.";
  // Saying it is offered only on a card that listens for it (a typed plan's does not: voice-mode.ts `hears`).
  const say = card.hears ? talkKey : null;
  if (content.kind === "question") return say ? `Hold ${say} and answer, or type it.` : "";
  return say ? `Press a button, or tap the Dashi key then Return. Or hold ${say} and say yes.` : "Press a button, or tap the Dashi key then Return.";
}

/**
 * The line at the card's foot: what Dashi hears, else "Stopped" for the moment after ❖Esc stopped its voice (as the
 * capsule says it after Cancel), else while it speaks the keys that stop it, else how to answer the card (D116).
 */
export function footOf(hint: string, listening: { text: string } | null, voice?: "speaking" | "stopped"): { words: string; loud: boolean; bold: boolean } {
  if (listening) return { words: listening.text || "Listening for your answer", loud: true, bold: false };
  if (voice === "stopped") return { words: "Stopped", loud: true, bold: true };
  if (voice === "speaking") return { words: `${STOP_KEYS} stops the voice.`, loud: false, bold: false };
  return { words: hint, loud: false, bold: false };
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

function Head({ content, colours, persona, asks }: { content: CardContent; colours: CapsuleColours; persona: CapsuleColours; asks: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s, marginBottom: SPACE.xs }}>
      <Disc colours={persona} size={CARD.disc} asks={asks} filled />
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: CARD.whoSize, fontWeight: WEIGHT.semibold, color: colours.text }}>
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
        gap: SPACE.xxs,
        borderRadius: RADIUS.control,
        paddingLeft: SPACE.m,
        paddingRight: SPACE.m,
        paddingTop: SPACE.s,
        paddingBottom: SPACE.s,
        marginTop: SPACE.xs,
        marginBottom: SPACE.s,
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

function Buttons({
  card,
  content,
  armed,
  colours,
  onAnswer,
}: {
  card: OpenCard;
  content: CardContent;
  armed: boolean;
  colours: CapsuleColours;
  onAnswer(answer: CardAnswer): void;
}) {
  const button = (label: string, answer: CardAnswer, primary = false) => (
    <Button
      key={label}
      label={label}
      primary={primary}
      off={!armed}
      colours={colours}
      card
      onPress={() => onAnswer(answer)}
      testID={`card-button:${answer.do}`}
    />
  );
  // Scrolled once, the same button reads on.
  const read = button(card.from === 0 ? "Read it all" : "More", { do: "read" }, true);
  if (content.kind === "reading") return <>{[button("Close", { do: "close" }, content.end), !content.end && read]}</>;
  // Past the limit there is no Yes until its end has been shown.
  if (!content.end) return <>{[button(content.kind === "permission" ? "No" : "Skip", { do: "no" }), read]}</>;
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
    // Each a row's width, in the kit's capsule look (UI-8).
    <View key={choice} style={{ flexDirection: "row", marginBottom: SPACE.xs }}>
      <KitButton
        testID={`card-choice:${choice}`}
        label={choice}
        look="capsule"
        fill
        inks={buttonInks(colours)}
        disabled={!armed}
        onPress={() => onAnswer({ do: "choose", text: choice })}
      />
    </View>
  ));
}

/**
 * The card's colours on its glass (frost-objects board 17): words in the glass's primary and secondary
 * inks, buttons outlined in the glass control edge and the yes filled in ink, choices on a fill.
 */
export function glassCardColours(colors: Palette, persona: CapsuleColours): CapsuleColours {
  return {
    fill: colors.tile,
    text: colors.text,
    soft: colors.textMuted,
    rim: colors.controlEdge,
    primary: colors.primary,
    onPrimary: colors.onPrimary,
    ok: colors.moss,
    amber: persona.amber,
  };
}

/** The card's rim: the persona's colour, or the purple focus rim while it has the keyboard (CP-11). */
export function cardRim(keyboard: boolean, personaColour: string, focusRing: string): { borderWidth: number; borderColor: string } {
  return keyboard ? { borderWidth: CARD.focusRim, borderColor: focusRing } : { borderWidth: CARD.rim, borderColor: personaColour };
}

export function Card(props: CardProps) {
  const rim = cardRim(props.card.keyboard, props.personaColour, useColors().focusRing);
  return (
    <Frosted
      level="regular"
      testID="card-glass"
      style={{ flexShrink: 0, width: CARD.width, maxHeight: CARD.maxHeight, borderRadius: CARD.radius, overflow: "hidden", ...rim, shadow: SHADOW.xl }}
    >
      <CardInside {...props} />
    </Frosted>
  );
}

function CardInside(props: CardProps) {
  const { card } = props;
  const colours = glassCardColours(useColors(), props.colours);
  const content = cardContent(card.what, props.name, card.from);
  const armed = useArmed(card.armsAt, props.now);
  const asks = content.kind !== "reading";
  const foot = footOf(hintOf(content, card, props.talkKey), props.listening, props.voice);
  return (
    <View
      testID={`card:${content.kind}`}
      accessibilityLabel={[content.who, content.about, content.question, ...content.lines, content.more].filter(Boolean).join(". ")}
      style={{
        flexDirection: "column",
        paddingLeft: CARD.paddingX,
        paddingRight: CARD.paddingX,
        paddingTop: CARD.paddingTop,
        paddingBottom: CARD.paddingBottom,
      }}
    >
      <Head content={content} colours={colours} persona={props.colours} asks={asks} />
      {content.question !== "" && <Text style={{ fontSize: CARD.questionSize, fontWeight: WEIGHT.semibold, color: colours.text }}>{content.question}</Text>}
      <Message content={content} colours={colours} />
      <Choices choices={content.choices} armed={armed} colours={colours} onAnswer={props.onAnswer} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s, marginTop: SPACE.xxs }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
          {props.listening && <Dots level={props.still ? null : props.level} color={colours.text} />}
          <View testID="card-hint" style={{ flex: 1, minWidth: 0 }}>
            {foot.words !== "" && (
              <KeyedText
                style={{
                  fontSize: CARD.hintSize,
                  lineHeight: CARD.hintSize * 1.35,
                  color: foot.loud ? colours.text : colours.soft,
                  ...(foot.bold ? { fontWeight: WEIGHT.semibold } : {}),
                }}
              >
                {foot.words}
              </KeyedText>
            )}
          </View>
        </View>
        <Buttons card={card} content={content} armed={armed} colours={colours} onAnswer={props.onAnswer} />
      </View>
    </View>
  );
}
