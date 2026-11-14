/**
 * Dashi's mark in the menu bar (docs/design.html, "The mark"; the design's
 * b-01, b-12, b-14): the spark on a small disc, always there, leading the
 * status items so the jobs can sit against it (menubar/lib/job-capsule.tsx).
 * A click turns the bar's row into the field (menubar/field.ts). While
 * something waits on the person it turns amber with an ink line and counts
 * them; the red dot shows while an agent sees or records the screen or uses
 * its own pointer. Pointing at it shows who and what in a tooltip under the
 * bar.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useRef } from "react";
import { opaque } from "./consent.tsx";
import { SPARK } from "./shared/settings/index.ts";

/** The mark's measures (docs/design.html, "The mark"). */
export const MARK = { height: 22, padding: 5, disc: 18, glyph: 12, dot: 12, askDisc: 16 } as const;

/** Amber, the colour of "needs you" (the design's #f0b93c), and the ink on it. */
const NEED = { fill: "#F0B93C", ink: "#1D1D1F", glyph: "#86600A" } as const;

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
          backgroundColor: "#ffffff",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: "bold", color: NEED.ink }}>?</Text>
      </View>
      <View testID="agent-mark-count">
        <Text style={{ fontSize: 11.5, fontWeight: "bold", color: NEED.ink }}>{String(need)}</Text>
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

export interface AgentMarkProps {
  /** How many things wait on the person: the mark turns amber and counts them. */
  need: number;
  /** An agent sees or records the screen, or uses its own pointer: the red dot. */
  watching: boolean;
  /** The bar's row is the field, opened from it: drawn pressed. */
  open: boolean;
  /** Dashi's colour (the persona's); the agents' purple unless set. */
  colour?: string;
  /** Dashi's glyph (the persona's mark, as SVG); the spark unless set. */
  glyph?: string;
  /** What a screen reader says. */
  label: string;
  /** The tooltip's words; "" for none. */
  tip: string;
  /** A click, with the mark's right edge in the bar. */
  onPress: (right: number) => void;
  /** The pointer came to rest on it (its words and bounds), or left (null). */
  onTip?: (tip: { text: string; bounds: Bounds } | null) => void;
  /** The Metal host takes accessibility props (launcher/access.ts); an older one refuses a tree that has them. */
  accessible?: boolean;
}

export function AgentMark({ need, watching, open, colour, glyph = SPARK, label, tip, onPress, onTip, accessible = false }: AgentMarkProps) {
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
  const box = (bounds?: Bounds) => bounds ?? laid.current ?? { x: 0, y: 0, width: 0, height: 0 };
  const asking = need > 0;
  const ink = colour ?? colors.agent;
  return (
    <View
      testID="agent-mark"
      onLayout={(bounds: Bounds) => {
        laid.current = bounds;
      }}
      onPress={({ bounds }: { bounds?: Bounds }) => {
        tipped.current = false;
        onTip?.(null);
        const at = box(bounds);
        onPress(at.x + at.width);
      }}
      onHoverChange={(hovered: boolean, bounds?: Bounds) => {
        if (tip === "") return;
        tipped.current = hovered;
        onTip?.(hovered ? { text: tip, bounds: box(bounds) } : null);
      }}
      {...(accessible ? { accessibilityRole: "button" as const, accessibilityLabel: label, accessibilityState: { expanded: open } } : {})}
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: MARK.height,
        paddingLeft: asking ? 3 : MARK.padding,
        paddingRight: asking ? 8 : MARK.padding,
        borderRadius: MARK.height / 2,
        position: "relative",
        backgroundColor: asking ? NEED.fill : open ? ink : colors.agentWash,
        ...(asking ? { borderWidth: 1.5, borderColor: NEED.ink } : {}),
      }}
    >
      {asking ? <Asking need={need} /> : <Spark ink={ink} glyph={glyph} />}
      {watching && <RedDot />}
    </View>
  );
}
