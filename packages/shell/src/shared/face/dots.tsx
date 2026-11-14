/**
 * Dashi's five dots, drawn: its face (docs/design.html, "Its face"). At rest they keep the
 * persona's shape; they breathe, blink, bounce and rise the character's own way (motion.ts); while
 * a voice is heard they are the level's bars. One timer runs while they are on screen and the way
 * moves by itself, and none otherwise: unmounted (the capsule is hidden), `still`, or listening,
 * where the level's own changes draw them.
 */

import { View } from "@mirinjs/metal";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dotShape, type PersonaDots, type PersonaMotion } from "../pill/index.ts";
import { FACE_HEIGHT, type FaceMood, faceFrame, faceTick, WORD_MS } from "./motion.ts";

export interface FaceDotsProps {
  dots: PersonaDots;
  motion: PersonaMotion;
  mood: FaceMood;
  color: string;
  /** Reduce Motion: the shape, and the level never moves it. */
  still?: boolean;
  /** The microphone's level while listening. */
  level?: { subscribe(listener: () => void): () => void; getSnapshot(): number } | null;
  /** The word being said (speak): each new one is a beat. */
  word?: number;
  gap?: number;
  testID?: string;
}

const NEVER = (): (() => void) => () => {};
const ZERO = (): number => 0;

export function FaceDots({ dots, motion, mood, color, still = false, level = null, word, gap = 4, testID = "face-dots" }: FaceDotsProps) {
  const way = still ? "still" : motion;
  const listening = mood === "listen" && way !== "still";
  const loud = useSyncExternalStore(listening ? (level?.subscribe ?? NEVER) : NEVER, listening ? (level?.getSnapshot ?? ZERO) : ZERO);
  const [now, setNow] = useState(() => performance.now());
  const [near, setNear] = useState(false);
  const began = useRef({ mood, at: now });
  if (began.current.mood !== mood) began.current = { mood, at: performance.now() };
  const said = useRef({ word, at: 0 });
  if (said.current.word !== word) said.current = { word, at: performance.now() };
  const every = faceTick(way, mood);
  useEffect(() => {
    if (every === 0) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  const at = Math.max(0, now - began.current.at);
  const sinceWord = word === undefined || said.current.at === 0 ? undefined : Math.max(0, now - said.current.at);
  const frame = faceFrame({
    shape: dotShape(dots),
    motion: way,
    mood,
    at,
    level: loud,
    near,
    ...(sinceWord !== undefined && sinceWord < WORD_MS ? { sinceWord } : {}),
  });
  return (
    <View
      testID={testID}
      onHoverChange={way === "still" ? undefined : setNear}
      style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-start", gap, height: FACE_HEIGHT }}
    >
      {frame.height.map((height, index) => {
        const width = frame.width[index] ?? 4;
        return (
          // The dots never reorder.
          <View
            key={index}
            style={{
              width,
              height,
              marginTop: Math.max(0, Math.min(FACE_HEIGHT - height, (FACE_HEIGHT - height) / 2 + (frame.dy[index] ?? 0))),
              borderRadius: Math.min(width, height) / 2,
              backgroundColor: color,
            }}
          />
        );
      })}
    </View>
  );
}
