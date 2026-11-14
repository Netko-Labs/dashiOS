/**
 * Dashi's one line, in its colour: what it heard (with Cancel and "Type it
 * instead" before anything runs), the step, the answer as it is spoken,
 * done. Led by its disc, or by five dots for a persona that chose them.
 */

import { CHECK } from "@dashi/ui";
import { Svg } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { type PersonaMark, STOP_KEYS, type VoiceModeCommand, type VoiceModeState } from "../../shared/pill/index.ts";
import { FaceLead } from "./face.tsx";
import type { Common } from "./line.tsx";
import type { CapsuleColours } from "./measures.ts";
import { charsIn, head, tail } from "./model.ts";
import { Button, Line, Separator, Working } from "./parts.tsx";

/** What leads Dashi's capsule: its disc with the persona's mark and its five dots, its face (face.tsx). */
const Lead = FaceLead;

/** What Dashi heard, before anything runs: the way out of the wrong capsule is here (Cancel, Type it instead). */
function Heard({
  text,
  chars,
  mark,
  send,
  colours,
  still,
}: {
  text: string;
  chars: number;
  mark: PersonaMark;
  send(command: VoiceModeCommand): void;
  colours: CapsuleColours;
  still: boolean;
}) {
  return (
    <>
      <Lead colours={colours} mark={mark} />
      <Line color={colours.text}>{tail(text, Math.max(8, chars - 26)) || "Thinking"}</Line>
      <Working color={colours.soft} still={still} />
      <Separator color={colours.soft} />
      {text !== "" && <Button label="Type it instead" colours={colours} onPress={() => send({ do: "type-instead" })} />}
      <Button label="Cancel" colours={colours} onPress={() => send({ do: "stop" })} />
    </>
  );
}

type VoiceProps = Common & { state: Exclude<VoiceModeState, { phase: "idle" }>; mark: PersonaMark; send(command: VoiceModeCommand): void };

export function VoiceLine({ state, mark, send, ...common }: VoiceProps): ReactNode {
  const { colours, level, still } = common;
  const chars = charsIn(common.tailPoints);
  const stop = (
    <Button
      label="Stop"
      square
      keys={STOP_KEYS}
      colours={colours}
      onPress={() => send(state.phase === "step" ? { do: "stop", task: state.task } : { do: "stop" })}
    />
  );
  switch (state.phase) {
    case "key-down":
      return <Lead colours={colours} mark={mark} />;
    case "listening": {
      const heard = tail(state.text, chars);
      return (
        <>
          <Lead colours={colours} mark={mark} listening={still ? null : level} />
          {heard !== "" ? (
            <Line color={colours.text}>{heard}</Line>
          ) : (
            <Line color={colours.soft}>{state.answering ? "Listening for your answer" : "Listening"}</Line>
          )}
        </>
      );
    }
    case "heard":
      return <Heard text={state.text} chars={chars} mark={mark} send={send} colours={colours} still={still} />;
    case "step":
      return (
        <>
          <Lead colours={colours} mark={mark} />
          <Line bold color={colours.text}>
            {head(state.title, Math.max(8, chars - 17))}
          </Line>
          {state.of > 1 && <Line color={colours.soft}>{`${state.index + 1} of ${state.of}`}</Line>}
          <Working color={colours.soft} still={still} />
          <Separator color={colours.soft} />
          {stop}
        </>
      );
    case "answer":
      return <AnswerLine words={state.words} at={state.at} chars={Math.max(8, chars - 15)} colours={colours} mark={mark} stop={stop} />;
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
