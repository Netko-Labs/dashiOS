/**
 * The agent mark in the menu bar (agents/mark.ts says what it draws; the
 * approved design is 46-menu-bar.html, A): each agent's harness glyph on a
 * small disc, overlapping, up to three, then "+N"; a ring turning around
 * the lead disc while one works (still with Reduce Motion); the red dot
 * while one sees or records the screen or uses its own pointer; and, only
 * while one needs the person, an amber pill that says "Waiting for you".
 * Pointing at it shows who and what in a tooltip under the bar; a click
 * opens the agents' panel (agents-panel.tsx).
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { discGlyph, type MarkState } from "./agents/index.ts";
import { opaque } from "./consent.tsx";

/** The mark's measures (docs/design.html, "The agent mark"). */
export const MARK = {
  height: 22,
  padding: 5,
  disc: 18,
  glyph: 12,
  /** How far a disc slides under the one before it. */
  overlap: 7,
  dot: 12,
  ring: 24,
  ringStroke: 1.6,
  /** The ring's steps around, and how long each shows: one turn in 1.44 s. */
  ringSteps: 12,
  ringStepMs: 120,
  askDisc: 16,
} as const;

/** Half a circle, from the top-left round the right, as the design's top and right borders. */
const arc = (turn: number): string => {
  const r = (MARK.ring - MARK.ringStroke) / 2;
  const c = MARK.ring / 2;
  const at = (degrees: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return `${(c + r * Math.cos(radians)).toFixed(2)} ${(c + r * Math.sin(radians)).toFixed(2)}`;
  };
  const from = -45 + turn;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK.ring} ${MARK.ring}"><path d="M${at(from)} A${r} ${r} 0 0 1 ${at(from + 180)}" stroke="#000" stroke-width="${MARK.ringStroke}" fill="none" stroke-linecap="round"/></svg>`;
};
const RING_STEPS = Array.from({ length: MARK.ringSteps }, (_, step) => arc((360 / MARK.ringSteps) * step));
/** The other half, faint: the ring as it stands with Reduce Motion. */
const RING_REST = arc(180);

/**
 * The ring around the lead disc. Metal has no rotation, so it steps through
 * twelve drawings, only while an agent works and Reduce Motion is off; with
 * it, it stands still, its other half faint, so it still says "working".
 */
function Ring({ reduceMotion }: { reduceMotion: () => boolean }) {
  const colors = useColors();
  const [step, setStep] = useState(0);
  const still = reduceMotion();
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => {
      if (!reduceMotion()) setStep((now) => (now + 1) % MARK.ringSteps);
    }, MARK.ringStepMs);
    return () => clearInterval(timer);
  }, [still, reduceMotion]);
  const place = { position: "absolute", left: -(MARK.ring - MARK.disc) / 2, top: -(MARK.ring - MARK.disc) / 2 } as const;
  return (
    <>
      {still && (
        <View style={place}>
          <Svg markup={RING_REST} size={MARK.ring} color={colors.agent} opacity={0.35} />
        </View>
      )}
      <View testID="agent-mark-ring" style={place}>
        <Svg markup={still ? (RING_STEPS[0] ?? "") : (RING_STEPS[step] ?? "")} size={MARK.ring} color={colors.agent} />
      </View>
    </>
  );
}

function Disc({ harness, size, color }: { harness: string | null; size: number; color: string }) {
  const colors = useColors();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: opaque(colors.launcher), alignItems: "center", justifyContent: "center" }}
    >
      <Svg markup={discGlyph(harness)} size={MARK.glyph} color={color} />
    </View>
  );
}

/** The red dot: an agent sees or records the screen, or uses its pointer. Ringed in the bar's color, so it reads on the mark. */
function RedDot() {
  const colors = useColors();
  return (
    <View
      testID="agent-mark-dot"
      style={{
        position: "absolute",
        top: -2,
        right: -2,
        width: MARK.dot,
        height: MARK.dot,
        borderRadius: MARK.dot / 2,
        borderWidth: 2,
        borderColor: opaque(colors.launcher),
        backgroundColor: colors.critical,
      }}
    />
  );
}

export interface AgentMarkProps {
  state: MarkState;
  /** The agents' panel is open from it: drawn pressed, in shiso. */
  open: boolean;
  /** A click, with the mark's right edge in the bar. */
  onPress: (right: number) => void;
  /** The pointer came to rest on it (its words and bounds), or left (null). */
  onTip?: (tip: { text: string; bounds: Bounds } | null) => void;
  reduceMotion: () => boolean;
  /** The Metal host takes accessibility props (launcher/access.ts); an older one refuses a tree that has them. */
  accessible?: boolean;
}

export function AgentMark({ state, open, onPress, onTip, reduceMotion, accessible = false }: AgentMarkProps) {
  const colors = useColors();
  const laid = useRef<Bounds | null>(null);
  // A press or the mark going takes its tooltip down (the latest `onTip`: the bar passes a new one each render).
  const tipped = useRef(false);
  const tipTo = useRef(onTip);
  tipTo.current = onTip;
  useEffect(
    () => () => {
      if (tipped.current) tipTo.current?.(null);
    },
    [],
  );
  if (state.kind === "none") return null;
  const box = (bounds?: Bounds) => bounds ?? laid.current ?? { x: 0, y: 0, width: 0, height: 0 };
  const events = {
    onLayout: (bounds: Bounds) => {
      laid.current = bounds;
    },
    onPress: ({ bounds }: { bounds?: Bounds }) => {
      tipped.current = false;
      onTip?.(null);
      const at = box(bounds);
      onPress(at.x + at.width);
    },
    onHoverChange: (hovered: boolean, bounds?: Bounds) => {
      tipped.current = hovered;
      onTip?.(hovered ? { text: state.tip, bounds: box(bounds) } : null);
    },
    ...(accessible ? { accessibilityRole: "button" as const, accessibilityLabel: state.label, accessibilityState: { expanded: open } } : {}),
  };
  if (state.kind === "ask") {
    return (
      <View
        testID="agent-mark"
        {...events}
        style={{
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          height: MARK.height,
          paddingLeft: MARK.padding,
          paddingRight: 9,
          borderRadius: MARK.height / 2,
          position: "relative",
          backgroundColor: open ? colors.broth : colors.brothWash,
        }}
      >
        <Disc harness={state.harness} size={MARK.askDisc} color={colors.broth} />
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: open ? opaque(colors.launcher) : colors.broth }}>
          Waiting for you
        </Text>
        {state.watching && <RedDot />}
      </View>
    );
  }
  return (
    <View
      testID="agent-mark"
      {...events}
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        height: MARK.height,
        paddingLeft: MARK.padding,
        paddingRight: MARK.padding,
        borderRadius: MARK.height / 2,
        position: "relative",
        backgroundColor: open ? colors.agent : colors.agentWash,
      }}
    >
      {state.discs.map((harness, index) => (
        <View key={index} style={{ position: "relative", ...(index === 0 ? {} : { marginLeft: -MARK.overlap }) }}>
          <Disc harness={harness} size={MARK.disc} color={colors.agent} />
          {index === 0 && state.working && <Ring reduceMotion={reduceMotion} />}
        </View>
      ))}
      {state.more > 0 && (
        <View style={{ marginLeft: 4 }}>
          <Text style={{ fontSize: 11.5, fontWeight: "semibold", color: open ? "#ffffff" : colors.agentInk }}>{`+${state.more}`}</Text>
        </View>
      )}
      {state.watching && <RedDot />}
    </View>
  );
}
