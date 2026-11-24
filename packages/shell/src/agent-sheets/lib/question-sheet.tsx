/**
 * "Claude asks": an agent's question to the person (`ask_person`). Dashi
 * says it out loud when Voice is on, and shows it here; the person answers
 * by holding the talk key and speaking, or by typing in the field. The
 * agent gets the answer as text. "Don’t answer", or no answer in time, is no
 * answer: Dashi never makes one up. The field is a plain one: this is not
 * where a password, a code or a card goes, and the sheet says so. The alert
 * frame (UI-5) with the agents' shiso tile; the field takes Enter and Esc.
 */

import { AlertSheet, TextField, TYPE, useColors } from "@dashi/ui";
import { Text } from "@mirinjs/metal";
import { useState } from "react";
import type { PersonAsk } from "../../agents/index.ts";
import { AGENT_GLYPH, agentOrigin, agentSubject } from "../../consent.tsx";

/** The sheet's surface, room for its shadow and a question of a few lines. */
export const QUESTION = { width: 500, height: 420 } as const;
const WIDTH = QUESTION.width - 60;

/** What Dashi says: who asks, then the question. */
export const spokenQuestion = (ask: Pick<PersonAsk, "who" | "question">): string => `${agentSubject(ask.who, true)} asks: ${ask.question}`;

export function QuestionSheet({ ask, talkKey, onAnswer }: { ask: PersonAsk; talkKey: string | null; onAnswer: (text: string | null) => void }) {
  const colors = useColors();
  const [text, setText] = useState("");
  const subject = agentSubject(ask.who, true);
  const origin = agentOrigin(ask.who);
  const answer = () => {
    if (text.trim() !== "") onAnswer(text.trim());
  };
  return (
    <AlertSheet
      testID="question-sheet"
      place="screen"
      keys={false}
      width={WIDTH}
      question={ask.question}
      message={origin === "" ? `${subject} asks` : `${subject} asks · ${origin}`}
      glyph={AGENT_GLYPH}
      tone="agent"
      buttons={[
        { label: "Don’t answer", testID: "question-decline", onPress: () => onAnswer(null), cancel: true },
        { label: "Answer", testID: "question-send", onPress: answer, kind: "primary", disabled: text.trim() === "" },
      ]}
    >
      <TextField
        testID="question-answer"
        value={text}
        placeholder="Type your answer"
        label={`Your answer to ${subject}`}
        onChangeText={setText}
        onSubmit={answer}
        onKeyPress={(key) => key === "Escape" && onAnswer(null)}
      />
      <Text style={{ fontSize: TYPE.caption.size, lineHeight: TYPE.caption.line, color: colors.textMuted }}>
        {`${talkKey ? `Or hold ${talkKey} and say it. ` : ""}${subject} gets your answer as text. Never a password, a code or a card: those are asked for on their own sheets.`}
      </Text>
    </AlertSheet>
  );
}
