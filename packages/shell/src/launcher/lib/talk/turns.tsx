/**
 * The conversation's turns as the launcher draws them (decisions.md D261;
 * the design's direction A, `dashi-0.9.0-design/askagent/`): the person's
 * words on the right in a quiet bubble (marked "Said" when spoken); Dashi's
 * turn under the persona's mark and name, its step lines (one line each, a
 * ring while it runs, a ✓ or ✗ after; folded into "N steps" once the
 * answer has come, each opened by a press), then its words as they are
 * written, paragraphs, lists, code and pressable links. A question that
 * waits is one line with its buttons; a failure says why with its one way on.
 */

import { ON_AGENT, OPACITY, pill, RADIUS, SPACE, useColors, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { DashiTurn, PersonTurn, TurnStep, Waiting } from "../../../agents/index.ts";
import { SPARKLE } from "../../../settings-app/glyphs.ts";
import { useMeasures } from "../measures.ts";
import { blocksOf, spansOf } from "./talk-mode.ts";

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const CHEVRON_RIGHT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;
const CHEVRON_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>`;
/** The mark over Dashi's turn: a 20 disc in the persona's colour, its spark 12; a step's running ring 12. */
const WHO = { disc: 20, glyph: 12, ring: 12 } as const;

/** The indent of Dashi's lines under its name: the mark's disc and its gap (27). */
export const TURN_INDENT = WHO.disc + SPACE.s + SPACE.px;

export function PersonBubble({ turn }: { turn: PersonTurn }) {
  const colors = useColors();
  const m = useMeasures();
  return (
    <View
      testID={`talk:person:${turn.id}`}
      style={{
        alignSelf: "flex-end",
        maxWidth: 460,
        backgroundColor: colors.button,
        borderRadius: RADIUS.sheet,
        paddingLeft: SPACE.inset,
        paddingRight: SPACE.inset,
        paddingTop: SPACE.s,
        paddingBottom: SPACE.m,
      }}
    >
      {turn.by === "voice" && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, marginBottom: SPACE.xxs }}>
          <Svg markup={MIC} size={11} color={colors.textMuted} />
          <Text style={{ fontSize: m.micro, color: colors.textMuted }}>Said</Text>
        </View>
      )}
      <Text style={{ fontSize: m.talk, color: colors.text }}>{turn.text}</Text>
    </View>
  );
}

/** The persona's mark and name at the top of Dashi's turn. */
export function Who({ name, colour, spoken }: { name: string; colour: string; spoken: boolean }) {
  const colors = useColors();
  const m = useMeasures();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
      <View
        style={{ width: WHO.disc, height: WHO.disc, borderRadius: pill(WHO.disc), backgroundColor: colour, alignItems: "center", justifyContent: "center" }}
      >
        <Svg markup={SPARKLE} size={WHO.glyph} color={ON_AGENT} />
      </View>
      <Text style={{ fontSize: m.line, fontWeight: WEIGHT.bold, color: colors.agentInk }}>{name}</Text>
      {spoken && <Text style={{ fontSize: m.small, color: colors.textMuted }}>spoken</Text>}
    </View>
  );
}

function StepLine({ step, open, onPress }: { step: TurnStep; open: boolean; onPress: () => void }) {
  const colors = useColors();
  const m = useMeasures();
  const running = step.ok === null;
  return (
    <View testID="talk:step" onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, height: 24 }}>
      <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
        {running ? (
          <View style={{ width: WHO.ring, height: WHO.ring, borderRadius: pill(WHO.ring), borderWidth: 2, borderColor: colors.agent, opacity: OPACITY.half }} />
        ) : (
          <Svg markup={step.ok ? CHECK : CROSS} size={13} color={step.ok ? colors.moss : colors.ume} />
        )}
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: m.talkDetail, color: running ? colors.text : colors.textMuted }}>
          {step.title}
        </Text>
      </View>
      {!running && <Svg markup={open ? CHEVRON_DOWN : CHEVRON_RIGHT} size={10} color={colors.textDisabled} />}
    </View>
  );
}

/** The step lines: each while it works; once the answer has come, folded into "N steps", which a press opens. */
export function Steps({ turn }: { turn: DashiTurn }) {
  const colors = useColors();
  const m = useMeasures();
  const [shown, setShown] = useState(false);
  const [opened, setOpened] = useState<number | null>(null);
  if (turn.steps.length === 0) return null;
  const folded = turn.state !== "working" && !shown;
  if (folded)
    return (
      <View
        testID="talk:steps-folded"
        onPress={() => setShown(true)}
        style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s, height: 22, paddingLeft: TURN_INDENT }}
      >
        <Svg markup={CHEVRON_RIGHT} size={10} color={colors.textMuted} />
        <Text style={{ fontSize: m.line, color: colors.textMuted }}>{turn.steps.length === 1 ? "1 step" : `${turn.steps.length} steps`}</Text>
      </View>
    );
  return (
    <View testID="talk:steps" style={{ flexDirection: "column", paddingLeft: TURN_INDENT }}>
      {turn.steps.map((step, index) => (
        <View key={`${index}:${step.title}`} style={{ flexDirection: "column" }}>
          <StepLine step={step} open={opened === index} onPress={() => setOpened(opened === index ? null : index)} />
          {opened === index && (
            <View style={{ marginLeft: SPACE.sheet, marginBottom: SPACE.xs, paddingLeft: SPACE.gap, borderLeftWidth: 2, borderColor: colors.separator }}>
              <Text style={{ fontSize: m.small, color: colors.textMuted }}>{step.ok === false ? "It didn't work." : "Done."}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/** One line of an answer: its words, with links pressable and code in the code look. */
function Line({ text, onLink }: { text: string; onLink: (url: string) => void }) {
  const colors = useColors();
  const m = useMeasures();
  const spans = spansOf(text);
  if (spans.every((span) => !span.url && !span.code))
    return (
      <View style={{ flexShrink: 1 }}>
        <Text style={{ fontSize: m.talk, color: colors.text }}>{text}</Text>
      </View>
    );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", flexShrink: 1 }}>
      {spans.map((span, index) =>
        span.url ? (
          <View key={index} testID="talk:link" onPress={() => onLink(span.url ?? "")}>
            <Text style={{ fontSize: m.talk, color: colors.accentInk, textDecorationLine: "underline" }}>{span.text}</Text>
          </View>
        ) : span.code ? (
          <View key={index} style={{ backgroundColor: colors.button, borderRadius: RADIUS.check, paddingLeft: SPACE.xxs, paddingRight: SPACE.xxs }}>
            <Text style={{ fontSize: m.line, color: colors.text, fontFamily: "monospace" }}>{span.text}</Text>
          </View>
        ) : (
          <Text key={index} style={{ fontSize: m.talk, color: colors.text }}>
            {span.text}
          </Text>
        ),
      )}
    </View>
  );
}

/** Dashi's words: paragraphs, list items with their marks, and code. */
export function Answer({ text, working, onLink }: { text: string; working: boolean; onLink: (url: string) => void }) {
  const colors = useColors();
  const m = useMeasures();
  const blocks = blocksOf(text);
  // The caret that shows the words are still coming sits at the end of the last line, not on a line of its own.
  const caret = (
    <View
      testID="talk:caret"
      style={{ width: 7, height: 14, borderRadius: RADIUS.thumb, backgroundColor: colors.agent, opacity: OPACITY.soft, marginLeft: SPACE.xxs }}
    />
  );
  const lastText = blocks.findLastIndex((block) => block.kind !== "code");
  return (
    <View testID="talk:answer" style={{ flexDirection: "column", gap: SPACE.s, paddingLeft: TURN_INDENT }}>
      {working && blocks.length === 0 && caret}
      {blocks.map((block, index) =>
        block.kind === "code" ? (
          <View key={index} style={{ backgroundColor: colors.button, borderRadius: RADIUS.row, padding: SPACE.m }}>
            <Text style={{ fontSize: m.small, fontFamily: "monospace", color: colors.text }}>{block.text}</Text>
          </View>
        ) : block.kind === "item" ? (
          <View key={index} style={{ flexDirection: "row", gap: SPACE.s, paddingLeft: SPACE.xs }}>
            <Text style={{ fontSize: m.talk, color: colors.textMuted }}>{block.mark}</Text>
            <Line text={block.text} onLink={onLink} />
          </View>
        ) : working && index === lastText ? (
          <View key={index} style={{ flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap" }}>
            <Line text={block.text} onLink={onLink} />
            {caret}
          </View>
        ) : (
          <Line key={index} text={block.text} onLink={onLink} />
        ),
      )}
    </View>
  );
}

/** A small button on a line: No, Yes, Open Terminal. */
export function LineButton({
  label,
  keys,
  primary,
  testID,
  onPress,
}: {
  label: string;
  keys?: string;
  primary?: boolean;
  testID: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const m = useMeasures();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.s,
        height: 24,
        paddingLeft: SPACE.inset,
        paddingRight: SPACE.inset,
        borderRadius: RADIUS.control,
        backgroundColor: primary ? colors.primary : colors.button,
      }}
    >
      <Text style={{ fontSize: m.line, fontWeight: WEIGHT.semibold, color: primary ? colors.onPrimary : colors.text }}>{label}</Text>
      {keys && <Text style={{ fontSize: m.micro, color: primary ? colors.onPrimary : colors.textMuted }}>{keys}</Text>}
    </View>
  );
}

/** A question that waits: one line, its words, No and Yes (↩ is yes); a question in words waits for the field. */
export function WaitingLine({ waiting, onAnswer }: { waiting: Waiting; onAnswer: (yes: boolean) => void }) {
  const colors = useColors();
  const m = useMeasures();
  return (
    <View
      testID="talk:waiting"
      style={{
        marginLeft: TURN_INDENT,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        padding: SPACE.m,
        paddingLeft: SPACE.inset,
        borderRadius: RADIUS.card,
        backgroundColor: colors.brothWash,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: m.title, color: colors.text }}>{waiting.text}</Text>
      </View>
      {waiting.kind === "yes-no" && (
        <>
          <LineButton testID="talk:no" label="No" onPress={() => onAnswer(false)} />
          <LineButton testID="talk:yes" label={waiting.yes ?? "Yes"} keys="↩" primary onPress={() => onAnswer(true)} />
        </>
      )}
    </View>
  );
}

/** A turn that failed: why, in its words, and its one way on. */
export function FailedLine({ turn, onGo }: { turn: DashiTurn; onGo: (go: "launcher" | "agents") => void }) {
  const colors = useColors();
  const m = useMeasures();
  const go = turn.failed?.go === "launcher" ? "launcher" : turn.failed?.go === "agents" ? "agents" : null;
  return (
    <View
      testID="talk:failed"
      style={{
        marginLeft: TURN_INDENT,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        padding: SPACE.m,
        paddingLeft: SPACE.inset,
        borderRadius: RADIUS.card,
        backgroundColor: colors.umeWash,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: m.title, color: colors.text }}>{turn.text}</Text>
      </View>
      {go && <LineButton testID="talk:go" label={go === "launcher" ? "Open Terminal" : "Open Settings"} keys="↩" primary onPress={() => onGo(go)} />}
    </View>
  );
}
