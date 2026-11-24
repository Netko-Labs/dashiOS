/**
 * Dashi's mark in the menu bar (docs/design.html, "The mark"; the design's
 * b-01, b-12, b-14): the spark on a small disc, in the bar only while
 * something acts that the person is not already watching (decisions.md
 * D261): an agent from outside, a run, Dashi kept working on its own. A
 * click opens the agents' panel. While
 * something waits on the person it turns amber with an ink line and counts
 * them; the red dot shows while an agent sees or records the screen or uses
 * its own pointer. It is the one sign of the agents connected from outside,
 * whatever their number (decisions.md D138): while one acts, its glyph
 * stands beside the spark, with how many sessions from two, and a click
 * there opens the agents' panel. Pointing at it shows who and what in a
 * tooltip under the bar.
 */

import { AMBER, CAPSULE, ON_AGENT, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useRef } from "react";
import { discGlyph } from "./agents/index.ts";
import { opaque } from "./consent.tsx";
import { SPARK } from "./shared/settings/index.ts";

/** The mark's measures (docs/design.html, "The mark"). */
export const MARK = { height: 22, padding: SPACE.xs, disc: 18, glyph: 12, dot: 12, askDisc: 16 } as const;

/** Amber, the colour of "needs you" (SH-7: one signal, the theme's AMBER), and the ink on it. */
const NEED = { fill: AMBER.fill, ink: AMBER.ink, glyph: AMBER.deep } as const;

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

/** Something waits on the person: "?" on a white disc, and how many. */
function Asking({ need }: { need: number }) {
  return (
    <>
      <View
        style={{
          width: MARK.askDisc,
          height: MARK.askDisc,
          borderRadius: MARK.askDisc / 2,
          backgroundColor: CAPSULE.white,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.bold, color: NEED.ink }}>?</Text>
      </View>
      <View testID="agent-mark-count">
        <Text style={{ fontSize: TYPE.panel.detail.size, fontWeight: WEIGHT.bold, color: NEED.ink }}>{String(need)}</Text>
      </View>
    </>
  );
}

/** At rest: Dashi's glyph on its disc (the spark, or the one the person chose). */
function Spark({ ink, glyph }: { ink: string; glyph: string }) {
  const colors = useColors();
  return (
    <View
      style={{
        width: MARK.disc,
        height: MARK.disc,
        borderRadius: MARK.disc / 2,
        backgroundColor: opaque(colors.launcher),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg markup={glyph} size={MARK.glyph} color={ink} />
    </View>
  );
}

/** The agents from outside at work: the first one's glyph and, from two sessions, how many. */
function Outside({ sessions, harness, ink }: { sessions: number; harness: string | null; ink: string }) {
  return (
    <>
      <Svg markup={discGlyph(harness)} size={MARK.glyph} color={ink} />
      {sessions > 1 && (
        <View testID="agent-mark-sessions">
          <Text style={{ fontSize: TYPE.panel.detail.size, fontWeight: WEIGHT.bold, color: ink }}>{String(sessions)}</Text>
        </View>
      )}
    </>
  );
}

/** Dashi's spark, and "Working" beside it while something works on its own. */
function Working({ ink, glyph, working }: { ink: string; glyph: string; working: boolean }) {
  const colors = useColors();
  return (
    <>
      <Spark ink={ink} glyph={glyph} />
      {working && (
        <View testID="agent-mark-working">
          <Text style={{ fontSize: TYPE.panel.detail.size, fontWeight: WEIGHT.semibold, color: colors.agentInk }}>Working</Text>
        </View>
      )}
    </>
  );
}

export interface AgentMarkProps {
  /** How many things wait on the person: the mark turns amber and counts them. */
  need: number;
  /** An agent sees or records the screen, or uses its own pointer: the red dot. */
  watching: boolean;
  /** Drawn pressed (its panel is open). */
  open: boolean;
  /** Something works on its own (a run, Dashi kept working): "Working" beside the mark, with its ring. */
  working?: boolean;
  /** Dashi's colour (the persona's); the agents' purple unless set. */
  colour?: string;
  /** Dashi's glyph (the persona's mark, as SVG); the spark unless set. */
  glyph?: string;
  /** What a screen reader says. */
  label: string;
  /** The tooltip's words; "" for none. */
  tip: string;
  /** The agents from outside in sight: how many sessions, and the first one's harness (null: the sparkle). */
  agents?: { sessions: number; harness: string | null };
  /** A click on the agents' part, with the mark's right edge in the bar: their panel. */
  onAgents?: (right: number) => void;
  /** A click, with the mark's right edge in the bar. */
  onPress: (right: number) => void;
  /** The pointer came to rest on it (its words and bounds), or left (null). */
  onTip?: (tip: { text: string; bounds: Bounds } | null) => void;
  /** The Metal host takes accessibility props (launcher/access.ts); an older one refuses a tree that has them. */
  accessible?: boolean;
}

export function AgentMark(props: AgentMarkProps) {
  const { need, watching, open, working = false, colour, glyph = SPARK, label, tip, agents, onAgents, onPress, onTip, accessible = false } = props;
  const colors = useColors();
  const laid = useRef<Bounds | null>(null);
  // A press or the mark going takes its tooltip down (the latest `onTip`: the bar passes a new one each render).
  const tipped = useRef(false);
  const tippedAt = useRef<Bounds | null>(null);
  const tipTo = useRef(onTip);
  tipTo.current = onTip;
  useEffect(
    () => () => {
      if (tipped.current) tipTo.current?.(null);
    },
    [],
  );
  // Its words follow what the agents do while the pointer rests on it.
  useEffect(() => {
    if (tipped.current && tippedAt.current) tipTo.current?.(tip === "" ? null : { text: tip, bounds: tippedAt.current });
  }, [tip]);
  const box = (bounds?: Bounds) => bounds ?? laid.current ?? { x: 0, y: 0, width: 0, height: 0 };
  const asking = need > 0;
  const ink = colour ?? colors.agent;
  // The agents' part is a press of its own; the spark keeps the field.
  const outside = !asking && agents !== undefined && agents.sessions > 0 ? agents : null;
  const press = (to: (right: number) => void) => (event: { bounds?: Bounds }) => {
    tipped.current = false;
    onTip?.(null);
    const at = laid.current ?? box(event.bounds);
    to(at.x + at.width);
  };
  return (
    <View
      testID="agent-mark"
      onLayout={(bounds: Bounds) => {
        laid.current = bounds;
      }}
      {...(outside ? {} : { onPress: press(onPress) })}
      onHoverChange={(hovered: boolean, bounds?: Bounds) => {
        if (tip === "") return;
        tipped.current = hovered;
        tippedAt.current = hovered ? box(bounds) : null;
        onTip?.(hovered ? { text: tip, bounds: box(bounds) } : null);
      }}
      {...(accessible ? { accessibilityRole: "button" as const, accessibilityLabel: label, accessibilityState: { expanded: open } } : {})}
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.xs,
        height: MARK.height,
        paddingLeft: asking ? SPACE.xxs : MARK.padding,
        paddingRight: asking || working || (outside && outside.sessions > 1) ? SPACE.m : MARK.padding,
        borderRadius: MARK.height / 2,
        position: "relative",
        backgroundColor: asking ? NEED.fill : open ? ink : colors.agentWash,
        ...(asking ? { borderWidth: 1.5, borderColor: NEED.ink } : {}),
      }}
    >
      {asking ? (
        <Asking need={need} />
      ) : outside ? (
        <>
          <View testID="agent-mark-spark" onPress={press(onPress)}>
            <Spark ink={ink} glyph={glyph} />
          </View>
          <View
            testID="agent-mark-agents"
            onPress={press(onAgents ?? onPress)}
            style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, height: MARK.height }}
          >
            <Outside sessions={outside.sessions} harness={outside.harness} ink={open ? ON_AGENT : colors.agentInk} />
          </View>
        </>
      ) : (
        <Working ink={ink} glyph={glyph} working={working} />
      )}
      {watching && <RedDot />}
    </View>
  );
}
