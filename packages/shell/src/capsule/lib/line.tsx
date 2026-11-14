/**
 * The capsule's shape, and dictation's one line in ink: five dots moving
 * with the voice, the words as heard, "Typed" with what changed, the words
 * that wait with Copy, one line of trouble. Core writes dictation's words;
 * this only draws them. Dashi's line is voice-line.tsx.
 */

import { CHECK, CLOSE } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { Cell, DictationCommand, DictationState } from "../../shared/pill/index.ts";
import { CAPSULE, type CapsuleColours } from "./measures.ts";
import { charsIn, head, tail } from "./model.ts";
import { Button, Dots, Line, Separator } from "./parts.tsx";

type Level = Pick<Cell<number>, "subscribe" | "getSnapshot">;

export interface Common {
  colours: CapsuleColours;
  /** The most of the words shown, in points. */
  tailPoints: number;
  level: Level;
  /** Reduce Motion. */
  still: boolean;
}

/** The first sentence of a line, bold, and the rest soft: "Typed" | "2 fillers out". */
function Told({ line, colours, chars }: { line: string; colours: CapsuleColours; chars: number }) {
  const cut = line.search(/[.:] /);
  const first = cut > 0 ? line.slice(0, cut) : line.replace(/\.$/, "");
  const rest = cut > 0 ? line.slice(cut + 2).replace(/\.$/, "") : "";
  return (
    <>
      <Line bold color={colours.text}>
        {head(first, chars)}
      </Line>
      {rest !== "" && <Separator color={colours.text} />}
      {rest !== "" && <Line color={colours.soft}>{head(rest, Math.max(8, chars - first.length))}</Line>}
    </>
  );
}

/** A small round press with a glyph: close. */
function Close({ colours, onPress }: { colours: CapsuleColours; onPress(): void }) {
  return (
    <View
      testID="capsule-close"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      style={{ flexShrink: 0, width: 18, height: 18, alignItems: "center", justifyContent: "center" }}
    >
      <Svg markup={CLOSE} size={11} color={colours.soft} />
    </View>
  );
}

export function DictationLine({
  state,
  send,
  ...common
}: Common & { state: Exclude<DictationState, { phase: "idle" }>; send(command: DictationCommand): void }): ReactNode {
  const { colours, level, still } = common;
  const chars = charsIn(common.tailPoints);
  switch (state.phase) {
    case "key-down":
      return <Dots level={null} color={colours.text} />;
    case "opening":
      // The microphone is not open yet: never drawn as listening.
      return <Dots level={null} color={colours.text} dim />;
    case "listening": {
      const heard = tail(state.text, chars);
      return (
        <>
          <Dots level={still ? null : level} color={colours.text} />
          {heard !== "" ? (
            <Line color={colours.text}>{heard}</Line>
          ) : (
            <Line color={colours.soft}>{head(state.hint ?? (state.handsFree ? "Hands-free" : "Listening"), chars)}</Line>
          )}
          {state.handsFree && <Separator color={colours.text} />}
          {state.handsFree && <Button label="Done" square colours={colours} onPress={() => send({ do: "finish" })} />}
        </>
      );
    }
    case "tidying":
      return (
        <>
          <Dots level={null} color={colours.text} dim />
          <Line bold color={colours.text}>
            Tidying
          </Line>
          {state.text !== "" && <Line color={colours.soft}>{tail(state.text, Math.max(8, chars - 10))}</Line>}
        </>
      );
    case "landed":
      return (
        <>
          <Svg markup={CHECK} size={13} color={colours.ok} />
          <Told line={state.line} colours={colours} chars={chars} />
        </>
      );
    case "waiting":
      return (
        <>
          <View style={{ flexShrink: 0, width: 7, height: 7, borderRadius: 3.5, backgroundColor: colours.amber }} />
          <Told line={state.line} colours={colours} chars={chars} />
          <Button label="Copy" primary colours={colours} onPress={() => send({ do: "copy" })} />
          <Close colours={colours} onPress={() => send({ do: "dismiss" })} />
        </>
      );
    case "notice":
      return (
        <>
          <View style={{ flexShrink: 0, width: 7, height: 7, borderRadius: 3.5, backgroundColor: colours.amber }} />
          <Line bold color={colours.text}>
            {head(state.line, chars)}
          </Line>
        </>
      );
  }
}

/** The capsule itself: the shape every line sits in. `tight` when it ends in a button, which sits closer to the edge than words do. */
export function Capsule({
  colours,
  children,
  maxWidth,
  dashi,
  tight,
  testID,
}: {
  colours: CapsuleColours;
  children: ReactNode;
  maxWidth: number;
  dashi: boolean;
  tight: boolean;
  testID: string;
}) {
  return (
    <View
      testID={testID}
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: CAPSULE.gap,
        height: CAPSULE.height,
        minWidth: CAPSULE.height,
        maxWidth,
        overflow: "hidden",
        // Dashi's disc leads from closer to the edge.
        paddingLeft: dashi ? 5 : CAPSULE.paddingX,
        paddingRight: tight ? 5 : CAPSULE.paddingX,
        borderRadius: CAPSULE.height / 2,
        backgroundColor: colours.fill,
        borderWidth: CAPSULE.rim,
        borderColor: colours.rim,
        shadow: "lg",
      }}
    >
      {children}
    </View>
  );
}
