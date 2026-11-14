/** Dashi's face (src/shared/face, src/shared/pill/look.ts, src/capsule/lib/face*.tsx): the marks, the dots' shapes, how each character moves them, and that nothing moves when it should not. */

import { expect, test } from "bun:test";
import { type NativeTransport, render } from "@mirinjs/metal";
import { FaceScope, faceNow, moodOf } from "../src/capsule/lib/face-scope.tsx";
import { CAPSULE } from "../src/capsule/lib/measures.ts";
import { dotHeights } from "../src/capsule/lib/parts.tsx";
import { CapsuleView, type ViewState } from "../src/capsule/lib/view.tsx";
import type { Place, Shown } from "../src/capsule/types.ts";
import { CHARACTERS, checkCharacterFile } from "../src/persona/index.ts";
import { BLINK_MS, FACE_HEIGHT, faceFrame, faceTick, WAYS, WORD_MS } from "../src/shared/face/index.ts";
import {
  cell,
  DEFAULT_PERSONA,
  DOT_SHAPES,
  dotShape,
  markSvg,
  PERSONA_DOTS,
  PERSONA_GLYPHS,
  PERSONA_MOTIONS,
  type Persona,
  type VoiceModeState,
} from "../src/shared/pill/index.ts";
import { SPARK } from "../src/shared/settings/index.ts";
import { settle } from "./support/time.ts";

test("eight marks, each a glyph of one colour on the 24 grid; the spark is the one the shell drew before", () => {
  expect(PERSONA_GLYPHS).toEqual(["spark", "bowl", "dot", "moon", "leaf", "drop", "flame", "paw"]);
  expect(markSvg("spark")).toBe(SPARK);
  expect(markSvg("dots")).toBe(SPARK);
  const drawn = new Set(PERSONA_GLYPHS.map((glyph) => markSvg(glyph)));
  expect(drawn.size).toBe(8);
  for (const svg of drawn) {
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).not.toMatch(/script|href|url\(|style=|<image|on[a-z]+=/i);
  }
});

test("six shapes of the dots, one for each character, and every one fits the capsule", () => {
  expect(DOT_SHAPES.map((shape) => shape.id)).toEqual([...PERSONA_DOTS]);
  expect(new Set(CHARACTERS.map((each) => each.dots)).size).toBe(6);
  expect(new Set(CHARACTERS.map((each) => each.motion)).size).toBe(6);
  expect(new Set(CHARACTERS.map((each) => each.mark)).size).toBe(6);
  for (const shape of DOT_SHAPES) {
    for (let dot = 0; dot < 5; dot++) expect(Math.abs(shape.dy[dot] ?? 0) + (shape.size[dot] ?? 0) / 2).toBeLessThanOrEqual(FACE_HEIGHT / 2);
  }
  // The design's four are its own numbers: 6 px is 4 points.
  expect(dotShape("smile").dy).toEqual([-2, 0.5, 2, 0.5, -2]);
  expect(dotShape("pearls").size).toEqual([2.5, 4, 6, 4, 2.5]);
});

test("still is the shape and nothing else, in every mood, and runs no timer", () => {
  for (const shape of DOT_SHAPES) {
    for (const mood of ["rest", "think", "speak"] as const) {
      const frame = faceFrame({ shape, motion: "still", mood, at: 1234, sinceWord: 10, near: true });
      expect(frame).toEqual({ dy: [...shape.dy], width: [...shape.size], height: [...shape.size] });
      expect(faceTick("still", mood)).toBe(0);
    }
    // Reduce Motion while listening: the level does not move them.
    expect(faceFrame({ shape, motion: "still", mood: "listen", at: 0, level: 0.9 }).height).toEqual([...shape.size]);
  }
});

test("while a voice is heard the dots are the level's bars, whatever the shape, and no timer runs", () => {
  for (const shape of DOT_SHAPES) {
    const loud = faceFrame({ shape, motion: "bright", mood: "listen", at: 0, level: 0.8 });
    expect(loud.height).toEqual(dotHeights(0.8));
    expect(loud.dy).toEqual([0, 0, 0, 0, 0]);
    expect(loud.width).toEqual([4, 4, 4, 4, 4]);
    expect(faceFrame({ shape, motion: "bright", mood: "listen", at: 0, level: 0 })).toEqual({
      dy: [...shape.dy],
      width: [...shape.size],
      height: [...shape.size],
    });
  }
  for (const motion of PERSONA_MOTIONS) expect(faceTick(motion, "listen")).toBe(0);
});

test("each character moves its own way: Kombu barely, Yuzu most, Wasabi turns its wave over", () => {
  const line = dotShape("line");
  const jump = (motion: keyof typeof WAYS): number =>
    Math.max(...faceFrame({ shape: line, motion, mood: "speak", at: 500, sinceWord: WORD_MS / 2 }).dy.map((dy) => -dy));
  expect(jump("bright")).toBeGreaterThan(jump("calm"));
  expect(jump("calm")).toBeGreaterThan(jump("quiet"));
  // Kombu: only the middle pearl answers a word.
  expect(faceFrame({ shape: dotShape("pearls"), motion: "quiet", mood: "speak", at: 500, sinceWord: WORD_MS / 2 }).dy).toEqual([0, 0, -0.5, 0, 0]);
  // Wasabi does not breathe, and each word turns its wave over.
  expect(faceTick("dry", "rest")).toBe(0);
  const wave = dotShape("wave");
  expect(faceFrame({ shape: wave, motion: "dry", mood: "speak", at: 500, sinceWord: WORD_MS / 2 }).dy).toEqual(wave.dy.map((dy) => -dy));
  // A word's jump is over after WORD_MS: the shape again.
  expect(faceFrame({ shape: wave, motion: "bright", mood: "speak", at: 900 }).dy).toEqual([...wave.dy]);
  // Every moving dot stays inside the capsule's room.
  for (const motion of Object.keys(WAYS) as Array<keyof typeof WAYS>) {
    for (const shape of DOT_SHAPES) {
      for (const mood of ["rest", "think", "speak"] as const) {
        for (let at = 0; at < 6000; at += 70) {
          const frame = faceFrame({ shape, motion, mood, at, sinceWord: at % 400, near: at % 3 === 0 });
          for (let dot = 0; dot < 5; dot++) expect(Math.abs(frame.dy[dot] ?? 0) + (frame.height[dot] ?? 0) / 2).toBeLessThanOrEqual(FACE_HEIGHT / 2 + 0.01);
        }
      }
    }
  }
});

test("it blinks once when it has heard you, then thinks", () => {
  const line = dotShape("line");
  expect(faceFrame({ shape: line, motion: "calm", mood: "think", at: BLINK_MS / 2 }).height).toEqual([1.5, 1.5, 1.5, 1.5, 1.5]);
  expect(faceFrame({ shape: line, motion: "calm", mood: "think", at: BLINK_MS + 1 }).height).toEqual([4, 4, 4, 4, 4]);
});

test("what Dashi is doing, from voice mode's phase", () => {
  const mood = (phase: VoiceModeState["phase"]) => moodOf({ phase });
  expect([mood("key-down"), mood("listening"), mood("heard"), mood("step"), mood("answer"), mood("done"), mood("notice")]).toEqual([
    "rest",
    "listen",
    "think",
    "think",
    "speak",
    "rest",
    "rest",
  ]);
  const home = { tail: CAPSULE.tail };
  const answer: Shown = { kind: "voice", state: { phase: "answer", words: ["It", "is"], at: 1, full: "It is" } };
  expect(faceNow(answer, home, DEFAULT_PERSONA, cell(0), false)).toMatchObject({ mood: "speak", word: 1, compact: false });
  expect(faceNow(answer, { tail: CAPSULE.seatTail }, DEFAULT_PERSONA, cell(0), false).compact).toBe(true);
});

const HOME: Place = { seat: "home", bottom: 80, at: { centre: true }, maxWidth: CAPSULE.maxWidth, tail: CAPSULE.tail };

async function capsule(shown: Shown, persona: Persona, place: Place = HOME) {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const state = cell<ViewState>({ shown, place, cardBottom: 63 });
  const hub = { persona: cell(persona), level: cell(0.5) };
  const root = render(
    <FaceScope state={state} persona={hub.persona} level={hub.level} still={() => false}>
      <CapsuleView
        state={state}
        level={hub.level}
        persona={hub.persona}
        still={() => false}
        talkKey={() => "the Dashi key"}
        now={() => 10_000}
        onDictation={() => {}}
        onVoice={() => {}}
        onCard={() => {}}
        onGo={() => {}}
        onBounds={() => {}}
      />
    </FaceScope>,
    transport,
  );
  await settle();
  const tree = trees.at(-1) ?? "";
  root.unmount?.();
  return { has: (testID: string): boolean => root.nodeId(testID) !== undefined, tree };
}

test("Dashi's capsule wears the persona's mark in its disc and its dots after it; dictation's never does", async () => {
  const miso: Persona = { ...DEFAULT_PERSONA, name: "Miso", mark: "bowl", dots: "smile", motion: "warm" };
  const down = await capsule({ kind: "voice", state: { phase: "key-down" } }, miso);
  expect(down.has("capsule-disc")).toBe(true);
  expect(down.has("capsule-face")).toBe(true);
  expect(down.tree).toContain("M2.500 11.500h19");
  // Beside the Dock, next to buttons, the disc stands alone.
  const seat: Place = { ...HOME, seat: "left", tail: CAPSULE.seatTail, maxWidth: CAPSULE.seatMaxWidth };
  const step: Shown = { kind: "voice", state: { phase: "step", task: "t", title: "Turn Dark Mode on", index: 0, of: 2 } };
  expect((await capsule(step, miso, seat)).has("capsule-face")).toBe(false);
  expect((await capsule(step, miso)).has("capsule-face")).toBe(true);
  // The first slice's "dots" mark: no disc, the face leads.
  const bare = await capsule({ kind: "voice", state: { phase: "key-down" } }, { ...miso, mark: "dots" });
  expect(bare.has("capsule-disc")).toBe(false);
  expect(bare.has("capsule-face")).toBe(true);
  const ink = await capsule({ kind: "dictation", state: { phase: "key-down" } }, miso);
  expect(ink.has("capsule-face")).toBe(false);
  expect(ink.has("capsule-dots")).toBe(true);
});

test("a character's file names its look by id only: an unknown or drawn one is Dashi's", () => {
  const file = (more: object) => JSON.stringify({ dashiCharacter: 1, id: "abuela", name: "Abuela", prompt: { en: "You fuss." }, ...more });
  const good = checkCharacterFile(file({ mark: "paw", dots: "hop", motion: "bright" }));
  expect(good.ok && [good.character.mark, good.character.dots, good.character.motion]).toEqual(["paw", "hop", "bright"]);
  const bad = checkCharacterFile(file({ mark: "<svg onload=alert(1)>", dots: { dy: [99] }, motion: "spin" }));
  expect(bad.ok && [bad.character.mark, bad.character.dots, bad.character.motion]).toEqual(["spark", "line", "calm"]);
});
