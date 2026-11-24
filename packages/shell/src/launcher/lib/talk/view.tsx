/**
 * The launcher grown into the conversation (decisions.md D261, the design's
 * direction A): the same width and place, the thread above and the field at
 * the bottom (the launcher's one chrome row). The thread's first line names
 * the model ("Dashi · Claude Code · opus"); it grows downward with the
 * turns to the launcher's height, then scrolls, kept at its newest line.
 * With nothing asked yet it says what can be asked: the person's recent
 * asks, else a few to try.
 */

import { ON_AGENT, pill, RADIUS, SPACE, useColors, WEIGHT } from "@dashi/ui";
import { ScrollView, Svg, Text, View, type ViewHandle } from "@mirinjs/metal";
import { useEffect, useRef } from "react";
import type { DashiTurn, TranscriptView } from "../../../agents/index.ts";
import { SPARKLE } from "../../../settings-app/glyphs.ts";
import { useMeasures } from "../measures.ts";
import { Answer, FailedLine, PersonBubble, Steps, TURN_INDENT, WaitingLine, Who } from "./turns.tsx";

/** The most the thread takes before it scrolls: the launcher's surface, less its field. */
export const THREAD_MOST = 540;

export interface TalkViewProps {
  view: TranscriptView;
  name: string;
  colour: string;
  /** What answers typed asks now, for the header and the empty view. */
  model: string | null;
  tries: readonly string[];
  /** The try selected (↑ ↓); Return in an empty field sends it. */
  selected: number;
  onTry(text: string): void;
  onHover(index: number): void;
  onAnswer(yes: boolean): void;
  onGo(go: "launcher" | "agents"): void;
  onLink(url: string): void;
}

/** The greeting's mark: a 24 disc in the persona's colour, its spark 14; the line under it starts past it. */
const GREETING = { disc: 24, glyph: 14 } as const;

function Empty({
  name,
  colour,
  model,
  tries,
  selected,
  onTry,
  onHover,
}: Pick<TalkViewProps, "name" | "colour" | "model" | "tries" | "selected" | "onTry" | "onHover">) {
  const colors = useColors();
  const m = useMeasures();
  return (
    <View testID="talk:empty" style={{ flexDirection: "column", paddingBottom: SPACE.s }}>
      <View
        style={{ flexDirection: "column", paddingLeft: SPACE.page, paddingRight: SPACE.page, paddingTop: SPACE.page, paddingBottom: SPACE.s, gap: SPACE.s }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}>
          <View
            style={{
              width: GREETING.disc,
              height: GREETING.disc,
              borderRadius: pill(GREETING.disc),
              backgroundColor: colour,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Svg markup={SPARKLE} size={GREETING.glyph} color={ON_AGENT} />
          </View>
          <Text style={{ fontSize: m.greeting, fontWeight: WEIGHT.bold, color: colors.text }}>{`Ask ${name}`}</Text>
        </View>
        <View style={{ paddingLeft: GREETING.disc + SPACE.m + SPACE.px }}>
          <Text style={{ fontSize: m.talkDetail, color: colors.textMuted }}>
            {`Say it as you would out loud: open apps and sites, change settings, find files, ask anything. Hold ❖Space to say it instead.${model ? ` ${model}.` : ""}`}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "column", paddingLeft: SPACE.xs, paddingRight: SPACE.xs }}>
        {tries.map((text, index) => (
          <View
            key={text}
            testID={`talk:try:${index}`}
            onPress={() => onTry(text)}
            onHoverChange={(hovered: boolean) => hovered && onHover(index)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: SPACE.gap,
              height: 34,
              paddingLeft: SPACE.inset,
              borderRadius: RADIUS.control,
              ...(index === selected ? { backgroundColor: colors.selectionWash } : {}),
            }}
          >
            <Svg markup={SPARKLE} size={14} color={colors.agent} />
            <Text numberOfLines={1} style={{ fontSize: m.title, color: colors.text }}>
              {text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** "Dashi · Claude Code · opus · Started by voice": the thread's first line, the model of its latest turn. */
function Header({ view, name, model }: { view: TranscriptView; name: string; model: string | null }) {
  const colors = useColors();
  const m = useMeasures();
  const shown = view.turns.findLast((turn): turn is DashiTurn => turn.kind === "dashi" && turn.model !== "")?.model ?? model;
  const spoken = view.turns[0]?.kind === "person" && view.turns[0].by === "voice";
  return (
    <View testID="talk:header" style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
      <Text style={{ fontSize: m.small, color: colors.textMuted }}>{name}</Text>
      {shown && (
        <View
          testID="talk:model"
          style={{
            backgroundColor: colors.button,
            borderRadius: RADIUS.row,
            paddingLeft: SPACE.s,
            paddingRight: SPACE.s,
            paddingTop: SPACE.px,
            paddingBottom: SPACE.px,
          }}
        >
          <Text style={{ fontSize: m.small, fontWeight: WEIGHT.semibold, color: colors.text }}>{shown}</Text>
        </View>
      )}
      {spoken && <Text style={{ fontSize: m.small, color: colors.textMuted }}>· Started by voice</Text>}
    </View>
  );
}

function DashiPart({ turn, last, props }: { turn: DashiTurn; last: boolean; props: TalkViewProps }) {
  const colors = useColors();
  const m = useMeasures();
  const { view } = props;
  const failed = turn.state === "failed";
  return (
    <View testID={`talk:dashi:${turn.id}`} style={{ flexDirection: "column", gap: SPACE.s }}>
      <Who name={props.name} colour={props.colour} spoken={turn.by === "voice"} />
      <Steps turn={turn} />
      {!failed && (turn.text || turn.state === "working") && (
        <Answer text={turn.text} working={turn.state === "working" && !view.waiting} onLink={props.onLink} />
      )}
      {failed && <FailedLine turn={turn} onGo={props.onGo} />}
      {turn.state === "stopped" && (
        <View style={{ paddingLeft: TURN_INDENT }}>
          <Text style={{ fontSize: m.small, color: colors.textMuted }}>Stopped.</Text>
        </View>
      )}
      {last && view.waiting && <WaitingLine waiting={view.waiting} onAnswer={props.onAnswer} />}
      {last && view.background && turn.state === "working" && (
        <View testID="talk:background" style={{ paddingLeft: TURN_INDENT }}>
          <Text style={{ fontSize: m.line, color: colors.textMuted }}>
            Working on its own now. You can close this: the menu bar shows it, and a notification says when it's done.
          </Text>
        </View>
      )}
    </View>
  );
}

export function TalkView(props: TalkViewProps) {
  const { view } = props;
  const scroll = useRef<ViewHandle | null>(null);
  const lastText = view.turns.at(-1);
  const tick = `${view.turns.length}:${lastText?.kind === "dashi" ? `${lastText.text.length}:${lastText.steps.length}` : ""}:${view.waiting?.id ?? ""}:${view.background}`;
  // Kept at the newest line as words and steps come.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` stands for what grew
  useEffect(() => scroll.current?.scrollToEnd(), [tick]);
  if (view.turns.length === 0) return <Empty {...props} />;
  const lastDashi = view.turns.findLastIndex((turn) => turn.kind === "dashi");
  return (
    <ScrollView ref={scroll} testID="talk:thread" style={{ maxHeight: THREAD_MOST, flexShrink: 1 }}>
      <View
        style={{
          flexDirection: "column",
          gap: SPACE.button,
          paddingLeft: SPACE.page,
          paddingRight: SPACE.page,
          paddingTop: SPACE.button,
          paddingBottom: SPACE.inset,
        }}
      >
        <Header view={view} name={props.name} model={props.model} />
        {view.turns.map((turn, index) =>
          turn.kind === "person" ? (
            <PersonBubble key={turn.id} turn={turn} />
          ) : (
            <DashiPart key={turn.id} turn={turn} last={index === lastDashi} props={props} />
          ),
        )}
      </View>
    </ScrollView>
  );
}
