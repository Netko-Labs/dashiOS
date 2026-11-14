/**
 * How Dashi's five dots move (docs/decisions.md D72): each character has its own way, and every
 * way is the same small arithmetic with other numbers. A frame is where each dot sits and how
 * wide and tall it is at one moment; nothing here keeps time or draws. While a voice is heard the
 * dots are level bars exactly as before, whatever the shape; `still` (and Reduce Motion, which
 * the drawer turns into `still`) is the shape and nothing else.
 */

import type { DotShape, PersonaMotion } from "../pill/index.ts";

/** What Dashi is doing: waiting, hearing the person, working, saying its answer. */
export type FaceMood = "rest" | "listen" | "think" | "speak";

export interface FaceMoment {
  shape: DotShape;
  motion: PersonaMotion;
  mood: FaceMood;
  /** Milliseconds since the mood began. */
  at: number;
  /** The microphone's level, 0 to 1 (listen). */
  level?: number;
  /** Milliseconds since the last word was said (speak); none while undefined. */
  sinceWord?: number;
  /** The pointer is on the dots: they rise to it. */
  near?: boolean;
}

export interface FaceFrame {
  /** Each dot's offset from the middle line, points, down is +. */
  dy: number[];
  width: number[];
  height: number[];
}

/** How the working dots move: a ripple along the row, the middle one alone, one after another, or the shape turned over. */
type Thinking = "ripple" | "pulse" | "scan" | "flip";

interface Way {
  /** A slow breath at rest: its period (ms) and how far a dot travels (points). 0 for none. */
  breath: number;
  rise: number;
  thinking: Thinking;
  /** One round of thinking, ms. */
  round: number;
  /** How high the dots jump on each word, points. */
  bounce: number;
  /** How far they rise to the pointer, points. */
  lean: number;
}

/** Dashi breathes. Miso's smile deepens. Kombu barely moves. Wasabi flips. Nori counts along. Yuzu bounces. */
export const WAYS: Readonly<Record<Exclude<PersonaMotion, "still">, Way>> = {
  calm: { breath: 4200, rise: 0.6, thinking: "ripple", round: 1400, bounce: 1.5, lean: 1 },
  warm: { breath: 3600, rise: 0.8, thinking: "ripple", round: 1200, bounce: 2, lean: 1.5 },
  quiet: { breath: 6000, rise: 0.3, thinking: "pulse", round: 2000, bounce: 0.5, lean: 0.5 },
  dry: { breath: 0, rise: 0, thinking: "flip", round: 1400, bounce: 1, lean: 0 },
  patient: { breath: 5000, rise: 0.5, thinking: "scan", round: 1600, bounce: 1, lean: 1 },
  bright: { breath: 2400, rise: 1.2, thinking: "ripple", round: 800, bounce: 3, lean: 2 },
};

/** The tallest a bar gets, and the room the dots have: the capsule's (capsule/lib/measures.ts `dotsHeight`). */
export const FACE_HEIGHT = 19;
/** The bars' weights at the loudest, the middle one tallest (capsule/lib/parts.tsx `dotHeights`). */
const BARS = [0.38, 0.73, 1, 0.65, 0.35];
/** How long a blink, a word's jump and a flip last, ms. */
export const BLINK_MS = 160;
export const WORD_MS = 260;
const TURN = Math.PI * 2;
const half = (value: number): number => Math.round(value * 2) / 2 + 0;
const clamp = (value: number): number => Math.min(1, Math.max(0, value));

const rest = (shape: DotShape): FaceFrame => ({ dy: [...shape.dy], width: [...shape.size], height: [...shape.size] });

/** Voice: the shape flattens into bars as the level rises. The same heights as dictation's dots at the same level. */
function bars(shape: DotShape, level: number): FaceFrame {
  const loud = clamp(level);
  const dot = 4;
  // By a third of the way up the shape is gone: plain bars from there, as dictation's.
  const flat = Math.min(1, loud * 3);
  return {
    dy: shape.dy.map((dy) => half(dy * (1 - flat))),
    width: shape.size.map((size) => half(size + (dot - size) * flat)),
    height: shape.size.map((size, index) => half(size + (dot - size) * flat + (FACE_HEIGHT - dot) * loud * (BARS[index] ?? 0))),
  };
}

function thinking(shape: DotShape, way: Way, at: number): FaceFrame {
  const frame = rest(shape);
  const turn = (at % way.round) / way.round;
  if (way.thinking === "flip") {
    // Wasabi: the shape turns over, holds, and turns back.
    const side = Math.cos(turn * TURN) >= 0 ? 1 : -1;
    frame.dy = shape.dy.map((dy) => dy * side);
  } else if (way.thinking === "pulse") {
    // Kombu: only the middle one, and slowly.
    const grow = 0.5 - 0.5 * Math.cos(turn * TURN);
    frame.width[2] = (shape.size[2] ?? 4) + grow;
    frame.height[2] = (shape.size[2] ?? 4) + grow;
  } else if (way.thinking === "scan") {
    // Nori: one dot after another steps up, left to right.
    const lit = Math.min(4, Math.floor(turn * 5));
    frame.dy[lit] = (shape.dy[lit] ?? 0) - 2;
  } else {
    frame.dy = shape.dy.map((dy, index) => dy - 1.5 * Math.max(0, Math.sin(turn * TURN - index * 0.9)));
  }
  return frame;
}

/** The five dots at one moment. Pure: the same moment is the same frame. */
export function faceFrame(moment: FaceMoment): FaceFrame {
  const { shape, motion, mood, at } = moment;
  if (mood === "listen") return bars(shape, motion === "still" ? 0 : (moment.level ?? 0));
  if (motion === "still") return rest(shape);
  const way = WAYS[motion];
  const frame = mood === "think" ? thinking(shape, way, Math.max(0, at - BLINK_MS)) : rest(shape);
  if (mood === "think" && at < BLINK_MS) {
    // It has heard you: one blink before it thinks.
    frame.height = frame.height.map(() => 1.5);
  }
  if (mood === "rest" && way.breath > 0) {
    const breath = Math.sin((at / way.breath) * TURN);
    // Miso's smile deepens as it breathes; the others drift.
    frame.dy =
      motion === "warm"
        ? shape.dy.map((dy) => dy * (1 + 0.2 * breath))
        : shape.dy.map((dy, index) => dy + way.rise * Math.sin((at / way.breath) * TURN - index * 0.5));
  }
  if (mood === "speak" && moment.sinceWord !== undefined && moment.sinceWord < WORD_MS) {
    const jump = Math.sin((moment.sinceWord / WORD_MS) * Math.PI);
    frame.dy =
      motion === "dry"
        ? shape.dy.map((dy) => dy * (1 - 2 * jump))
        : frame.dy.map((dy, index) => dy - way.bounce * jump * (motion === "quiet" && index !== 2 ? 0 : 1));
  }
  if (moment.near) frame.dy = frame.dy.map((dy) => dy - way.lean);
  // No dot leaves the capsule's room, however the jump, the lean and the shape add up.
  frame.dy = frame.dy.map((dy, index) => {
    const room = (FACE_HEIGHT - (frame.height[index] ?? 0)) / 2;
    return Math.min(room, Math.max(-room, dy));
  });
  return frame;
}

/** How often the dots are drawn anew, ms; 0 when nothing moves by itself, and then no timer runs at all. */
export function faceTick(motion: PersonaMotion, mood: FaceMood): number {
  if (motion === "still" || mood === "listen") return 0;
  if (mood === "speak") return 33;
  if (mood === "think") return WAYS[motion].thinking === "ripple" ? 50 : 100;
  return WAYS[motion].breath > 0 ? 80 : 0;
}
