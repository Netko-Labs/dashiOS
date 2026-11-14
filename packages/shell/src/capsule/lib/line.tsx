/**
 * The capsule's one line: dictation's in ink (five dots moving with the
 * voice, the words as heard, "Typed" with what changed, the words that wait
 * with Copy, one line of trouble), and Dashi's in its colour (what it heard,
 * the step, the answer as it is spoken, done). Core writes dictation's
 * words; these only draw them.
 */

import { CHECK, CLOSE } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { Cell, DictationCommand, DictationState, PersonaMark, VoiceModeCommand, VoiceModeState } from "../../shared/pill/index.ts";
import { CAPSULE, type CapsuleColours } from "./measures.ts";
import { charsIn, head, tail } from "./model.ts";
import { Button, Disc, Dots, Line, Separator, Working } from "./parts.tsx";

type Level = Pick<Cell<number>, "subscribe" | "getSnapshot">;

interface Common {
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

/** What leads Dashi's capsule: its disc with the spark, or five dots for a persona that chose them. */
function Lead({ colours, mark }: { colours: CapsuleColours; mark: PersonaMark }) {
  return mark === "dots" ? <Dots level={null} color={colours.text} /> : <Disc colours={colours} />;
}

type VoiceProps = Common & { state: Exclude<VoiceModeState, { phase: "idle" }>; mark: PersonaMark; send(command: VoiceModeCommand): void };

export function VoiceLine({ state, mark, send, ...common }: VoiceProps): ReactNode {
  const { colours, level, still } = common;
  const chars = charsIn(common.tailPoints);
  const stop = (
    <Button label="Stop" square colours={colours} onPress={() => send(state.phase === "step" ? { do: "stop", task: state.task } : { do: "stop" })} />
  );
  switch (state.phase) {
    case "key-down":
      return <Lead colours={colours} mark={mark} />;
    case "listening": {
      const heard = tail(state.text, chars);
      return (
        <>
          {/* A persona whose mark is the dots leads with the ones that move. */}
          {mark === "spark" && <Lead colours={colours} mark={mark} />}
          <Dots level={still ? null : level} color={colours.text} />
          {heard !== "" ? (
            <Line color={colours.text}>{heard}</Line>
          ) : (
            <Line color={colours.soft}>{state.answering ? "Listening for your answer" : "Listening"}</Line>
          )}
        </>
      );
    }
    case "heard":
      // Nothing has run yet: the way out of the wrong capsule is here.
      return (
        <>
          <Lead colours={colours} mark={mark} />
          <Line color={colours.text}>{tail(state.text, Math.max(8, chars - 26)) || "Thinking"}</Line>
          <Working color={colours.soft} still={still} />
          <Separator color={colours.soft} />
          {state.text !== "" && <Button label="Type it instead" colours={colours} onPress={() => send({ do: "type-instead" })} />}
          <Button label="Cancel" colours={colours} onPress={() => send({ do: "stop" })} />
        </>
      );
    case "step":
      return (
        <>
          <Lead colours={colours} mark={mark} />
          <Line bold color={colours.text}>
            {head(state.title, Math.max(8, chars - 12))}
          </Line>
          {state.of > 1 && <Line color={colours.soft}>{`${state.index + 1} of ${state.of}`}</Line>}
          <Working color={colours.soft} still={still} />
          <Separator color={colours.soft} />
          {stop}
        </>
      );
    case "answer":
      return <AnswerLine words={state.words} at={state.at} chars={Math.max(8, chars - 10)} colours={colours} mark={mark} stop={stop} />;
    case "done":
      return (
        <>
          <Lead colours={colours} mark={mark} />
          <Svg markup={CHECK} size={13} color={colours.ok} />
          <Line bold color={colours.text}>
            {head(state.line, chars)}
          </Line>
        </>
      );
    case "stopped":
      return (
        <>
          <Lead colours={colours} mark={mark} />
          <Line bold color={colours.text}>
            Stopped
          </Line>
        </>
      );
    case "notice":
      return (
        <>
          <Lead colours={colours} mark={mark} />
          <Line bold color={colours.text}>
            {head(state.line, chars)}
          </Line>
        </>
      );
  }
}

/** The words Dashi speaks, a line's worth around the one being said: said ones bold, the rest soft. */
export function spokenLine(words: readonly string[], at: number, chars: number): { said: string; coming: string } {
  const lines: Array<{ from: number; to: number }> = [];
  let from = 0;
  let length = 0;
  words.forEach((word, index) => {
    if (index > from && length + 1 + word.length > chars) {
      lines.push({ from, to: index });
      from = index;
      length = 0;
    }
    length += (length === 0 ? 0 : 1) + word.length;
  });
  lines.push({ from, to: words.length });
  const now = lines.find((line) => at < line.to) ?? lines.at(-1) ?? { from: 0, to: 0 };
  const said = Math.max(now.from, Math.min(at + 1, now.to));
  return { said: words.slice(now.from, said).join(" "), coming: words.slice(said, now.to).join(" ") };
}

function AnswerLine(props: { words: readonly string[]; at: number; chars: number; colours: CapsuleColours; mark: PersonaMark; stop: ReactNode }) {
  const { said, coming } = spokenLine(props.words, props.at, props.chars);
  return (
    <>
      <Lead colours={props.colours} mark={props.mark} />
      {said !== "" && (
        <Line bold color={props.colours.text} testID="capsule-said">
          {said}
        </Line>
      )}
      {coming !== "" && <Line color={props.colours.soft}>{coming}</Line>}
      <Separator color={props.colours.soft} />
      {props.stop}
    </>
  );
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
