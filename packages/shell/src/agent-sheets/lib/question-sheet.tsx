/**
 * "Claude asks": an agent's question to the person (`ask_person`). Dashi
 * says it out loud when Voice is on, and shows it here; the person answers
 * by holding the talk key and speaking, or by typing in the field. The
 * agent gets the answer as text. "Don't Answer", or no answer in time, is no
 * answer: Dashi never makes one up. The field is a plain one: this is not
 * where a password, a code or a card goes, and the sheet says so.
 */

import { useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import type { PersonAsk } from "../../agents/index.ts";
import { AgentMark, Button, opaque } from "../../consent.tsx";

/** The sheet's surface, room for its shadow and a question of a few lines. */
export const QUESTION = { width: 500, height: 420 } as const;

/** What Dashi says: who asks, then the question. */
export const spokenQuestion = (ask: Pick<PersonAsk, "who" | "question">): string =>
  `${ask.who.remote ? "An agent on another machine" : ask.who.name} asks: ${ask.question}`;

export function QuestionSheet({ ask, talkKey, onAnswer }: { ask: PersonAsk; talkKey: string | null; onAnswer: (text: string | null) => void }) {
  const colors = useColors();
  const [text, setText] = useState("");
  const subject = ask.who.remote ? "An agent on another machine" : ask.who.name;
  const origin = [ask.who.detail, ask.who.claims ? `says it is “${ask.who.claims}”` : null].filter(Boolean).join(" · ");
  const answer = () => {
    if (text.trim() !== "") onAnswer(text.trim());
  };
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        testID="question-sheet"
        style={{
          width: QUESTION.width - 60,
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: 22,
          borderRadius: 18,
          backgroundColor: opaque(colors.launcher),
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <AgentMark size={46} />
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{`${subject} asks`}</Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{origin}</Text>
        <View style={{ marginTop: 10, alignSelf: "stretch" }}>
          <Text style={{ fontSize: 14, color: colors.text, textAlign: "center" }}>{ask.question}</Text>
        </View>
        <View
          style={{
            alignSelf: "stretch",
            marginTop: 14,
            height: 32,
            paddingLeft: 10,
            paddingRight: 10,
            justifyContent: "center",
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.separator,
            backgroundColor: colors.tile,
          }}
        >
          <TextInput
            testID="question-answer"
            value={text}
            placeholder="Type your answer"
            accessibilityLabel={`Your answer to ${subject}`}
            onChangeText={setText}
            onSubmitEditing={answer}
            onKeyPress={(key) => key === "Escape" && onAnswer(null)}
            style={{ fontSize: 13, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
          />
        </View>
        <View style={{ alignSelf: "stretch", marginTop: 8 }}>
          <Text style={{ fontSize: 11.5, color: colors.textMuted, textAlign: "center" }}>
            {`${talkKey ? `Or hold ${talkKey} and say it. ` : ""}${subject} gets your answer as text. Never a password, a code or a card: those are asked for on their own sheets.`}
          </Text>
        </View>
        <View style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Button testID="question-decline" label="Don't Answer" onPress={() => onAnswer(null)} />
          <Button testID="question-send" label="Answer" primary onPress={answer} />
        </View>
      </View>
    </View>
  );
}
