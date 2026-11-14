/**
 * Whose face the capsule wears now (docs/decisions.md D75, D76): the persona's mark and dots, and
 * what Dashi is doing, kept where the disc and the dots can read them without each line carrying
 * them down. start.tsx sets the scope round the view; with no scope (a line drawn alone) the disc
 * is the spark and the dots are as they were.
 */

import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import type { FaceMood } from "../../shared/face/index.ts";
import { type Cell, DEFAULT_PERSONA, markSvg, type Persona, type VoiceModeState } from "../../shared/pill/index.ts";
import type { Place, Shown } from "../types.ts";
import { CAPSULE } from "./measures.ts";

type Read<T> = Pick<Cell<T>, "subscribe" | "getSnapshot">;

export interface FaceNow {
  persona: Persona;
  mood: FaceMood;
  /** The word being said, while it speaks. */
  word: number | undefined;
  level: Read<number>;
  /** Reduce Motion. */
  still: boolean;
  /** The small seat beside the Dock: no room for the dots beside buttons. */
  compact: boolean;
}

const Scope = createContext<FaceNow | null>(null);

/** What Dashi is doing in a phase of voice mode: waiting, hearing, working, saying. */
export function moodOf(state: Pick<VoiceModeState, "phase">): FaceMood {
  if (state.phase === "listening") return "listen";
  if (state.phase === "heard" || state.phase === "step") return "think";
  return state.phase === "answer" ? "speak" : "rest";
}

/** The face for what shows: a card's is at rest, or listening while it hears the answer. */
export function faceNow(shown: Shown, place: Pick<Place, "tail">, persona: Persona, level: Read<number>, still: boolean): FaceNow {
  const state = shown.kind === "voice" ? shown.state : shown.kind === "card" ? shown.listening : null;
  return {
    persona,
    mood: state ? moodOf(state) : "rest",
    word: state?.phase === "answer" ? state.at : undefined,
    level,
    still,
    compact: place.tail < CAPSULE.tail,
  };
}

export function FaceScope(props: {
  state: Read<{ shown: Shown; place: Place }>;
  persona: Read<Persona>;
  level: Read<number>;
  still(): boolean;
  children: ReactNode;
}) {
  const { shown, place } = useSyncExternalStore(props.state.subscribe, props.state.getSnapshot);
  const persona = useSyncExternalStore(props.persona.subscribe, props.persona.getSnapshot);
  return <Scope.Provider value={faceNow(shown, place, persona, props.level, props.still())}>{props.children}</Scope.Provider>;
}

export const useFace = (): FaceNow | null => useContext(Scope);

/** The glyph in Dashi's disc: the persona's, the spark with no scope. */
export const useFaceMark = (): string => markSvg((useContext(Scope)?.persona ?? DEFAULT_PERSONA).mark);
