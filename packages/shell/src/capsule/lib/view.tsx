/**
 * What the capsule's surface draws: nothing, the capsule in its seat, or the
 * card on the Dock. The surface is the screen's width; what is drawn reports
 * its bounds, which is all of it that takes the pointer.
 */

import { useDark } from "@dashi/ui";
import { type Bounds, View } from "@mirinjs/metal";
import { type ReactNode, useSyncExternalStore } from "react";
import type { Cell, DictationCommand, Persona, VoiceModeCommand } from "../../shared/pill/index.ts";
import type { Place, Shown } from "../types.ts";
import { Card, type CardAnswer } from "./card.tsx";
import { Capsule, DictationLine } from "./line.tsx";
import { dashiColours, inkColours } from "./measures.ts";
import { VoiceLine } from "./voice-line.tsx";

/** What shows, and where. */
export interface ViewState {
  shown: Shown;
  place: Place;
  /** A card's bottom edge, from the screen's. */
  cardBottom: number;
}

type Read<T> = Pick<Cell<T>, "subscribe" | "getSnapshot">;

export interface CapsuleViewProps {
  state: Read<ViewState>;
  level: Read<number>;
  persona: Read<Persona>;
  /** Reduce Motion. */
  still(): boolean;
  talkKey(): string | null;
  now(): number;
  onDictation(command: DictationCommand): void;
  onVoice(command: VoiceModeCommand): void;
  onCard(answer: CardAnswer): void;
  /** Where what is drawn is, in the surface. */
  onBounds(bounds: Bounds): void;
}

/** Whether the line ends in a button, which sits closer to the capsule's edge than words do. */
function endsInButton(shown: Shown): boolean {
  if (shown.kind === "dictation") return shown.state.phase === "listening" && shown.state.handsFree;
  return shown.kind === "voice" && (shown.state.phase === "heard" || shown.state.phase === "step" || shown.state.phase === "answer");
}

/** The row along the bottom that holds the capsule in its seat. */
function Seat({ place, children }: { place: Place; children: ReactNode }) {
  const side =
    "centre" in place.at ? { left: 0, right: 0, justifyContent: "center" as const } : "left" in place.at ? { left: place.at.left } : { right: place.at.right };
  return (
    <View testID={`capsule-seat:${place.seat}`} style={{ position: "absolute", bottom: place.bottom, flexDirection: "row", ...side }}>
      {children}
    </View>
  );
}

export function CapsuleView(props: CapsuleViewProps) {
  const { shown, place, cardBottom } = useSyncExternalStore(props.state.subscribe, props.state.getSnapshot);
  const persona = useSyncExternalStore(props.persona.subscribe, props.persona.getSnapshot);
  const dark = useDark();
  const still = props.still();
  if (shown.kind === "none") return <View testID="capsule-none" style={{ flex: 1 }} />;
  const dashi = dashiColours(persona.colour);
  if (shown.kind === "card") {
    return (
      <View style={{ flex: 1, position: "relative" }}>
        <View style={{ position: "absolute", left: 0, right: 0, bottom: cardBottom, flexDirection: "row", justifyContent: "center" }}>
          <View onLayout={props.onBounds} style={{ flexShrink: 0 }}>
            <Card
              card={shown.card}
              colours={dashi}
              name={persona.name}
              talkKey={props.talkKey()}
              listening={shown.listening}
              level={props.level}
              still={still}
              now={props.now}
              onAnswer={props.onCard}
            />
          </View>
        </View>
      </View>
    );
  }
  const common = { tailPoints: place.tail, level: props.level, still };
  return (
    <View style={{ flex: 1, position: "relative" }}>
      <Seat place={place}>
        <View onLayout={props.onBounds} style={{ flexShrink: 0 }}>
          {shown.kind === "dictation" ? (
            <Capsule
              colours={inkColours(dark)}
              maxWidth={place.maxWidth}
              dashi={false}
              tight={endsInButton(shown)}
              testID={`capsule:dictation:${shown.state.phase}`}
            >
              <DictationLine state={shown.state} send={props.onDictation} colours={inkColours(dark)} {...common} />
            </Capsule>
          ) : (
            <Capsule
              colours={dashi}
              maxWidth={place.maxWidth}
              dashi={persona.mark === "spark"}
              tight={endsInButton(shown)}
              testID={`capsule:voice:${shown.state.phase}`}
            >
              <VoiceLine state={shown.state} mark={persona.mark} send={props.onVoice} colours={dashi} {...common} />
            </Capsule>
          )}
        </View>
      </Seat>
    </View>
  );
}
