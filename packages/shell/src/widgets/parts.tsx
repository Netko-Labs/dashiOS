/** The pieces every widget is printed from (round five's chrome.js): labels, words, the one number, buttons, rules and blanks. */

import { Svg, Text, View, type ViewStyle } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { type GlyphName, glyph } from "../shared/inks/index.ts";
import { useHostAbilities } from "../shared/metal/index.ts";
import { numberFace, unitFace } from "./lib/numerals.ts";
import { useCard, useRedacted } from "./look.tsx";

/**
 * A line cut to `max` characters at a word, with an ellipsis: mirin's host
 * draws nothing for a one-line text squeezed by a flexible box, so the words
 * are cut here and a text is never wrapped in `flex: 1` (as the
 * notifications' cards do).
 */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** A label: small capitals in the secondary ink ("LISBON"). Metal has no letter-spacing, so it is upper-cased only. */
export function Lab({ children, strong, max = 30 }: { children: string; strong?: boolean; max?: number }) {
  const c = useCard();
  return <Text style={{ fontSize: 10.5, fontWeight: "semibold", color: strong ? c.ink : c.secondary }}>{cut(children.toUpperCase(), max)}</Text>;
}

/** A small line in the tertiary ink: one line, cut with an ellipsis at `max`. */
export function Meta({ children, max = 32 }: { children: string; max?: number }) {
  const c = useCard();
  return (
    <Text numberOfLines={1} style={{ fontSize: 11.5, color: c.tertiary }}>
      {cut(children, max)}
    </Text>
  );
}

/** A title line: 13, semibold, ink; one line with an ellipsis. */
export function Title({
  children,
  size = 13,
  weight = "semibold",
  max = 34,
}: {
  children: string;
  size?: number;
  weight?: "semibold" | "500" | "normal";
  max?: number;
}) {
  const c = useCard();
  return (
    <Text numberOfLines={1} style={{ fontSize: size, fontWeight: weight, color: c.ink }}>
      {cut(children, max)}
    </Text>
  );
}

/** Body words: 12.5 in the secondary ink. */
export function Words({ children, lines = 1, ink, max = 40 }: { children: string; lines?: number; ink?: boolean; max?: number }) {
  const c = useCard();
  return (
    <Text {...(lines === 1 ? { numberOfLines: 1 as const } : {})} style={{ fontSize: 12.5, lineHeight: 17, color: ink ? c.ink : c.secondary }}>
      {lines === 1 ? cut(children, max) : children}
    </Text>
  );
}

/**
 * The one number (role "value"): printed in the card's ink, its unit beside
 * it at max(14, 0.3 em) in the same ink, weight 400 (#12). Inter Display,
 * its weight following the value (#14: `weight` 0–1 → 300 to 500) where the
 * host draws it, Regular or Medium on an older one (lib/numerals.ts).
 */
export function Num({
  value,
  unit,
  size,
  weight = 0,
  plain,
  ink,
}: {
  value: string;
  unit?: string;
  size: number;
  weight?: number;
  plain?: boolean;
  ink?: string;
}) {
  const c = useCard();
  const colour = ink ?? (plain ? c.ink : c.value);
  const abilities = useHostAbilities();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <Text style={{ fontSize: size, lineHeight: Math.round(size * 0.95), color: colour, ...numberFace(abilities, size, weight) }}>{value}</Text>
      {unit ? (
        <View style={{ marginLeft: 2, marginTop: Math.round(size * 0.06) }}>
          <Text style={{ fontSize: Math.max(14, size * 0.3), color: colour, ...unitFace(abilities) }}>{unit}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function Glyph({ name, size = 14, tone = "ink" }: { name: GlyphName; size?: number; tone?: "ink" | "value" | "secondary" | "tertiary" }) {
  const c = useCard();
  return <Svg markup={glyph(name)} size={size} color={c[tone]} />;
}

/** The header row: a label at the left, something at the right. */
export function Head({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "stretch", justifyContent: "space-between", height: 14, gap: 8 }}>
      {left}
      {right ? <View style={{ marginLeft: "auto" }}>{right}</View> : null}
    </View>
  );
}

export const Grow = () => <View style={{ flex: 1 }} />;

export function Rule() {
  const c = useCard();
  return <View style={{ height: 1, backgroundColor: c.hairline }} />;
}

export function VRule({ margin = 12 }: { margin?: number }) {
  const c = useCard();
  return <View style={{ width: 1, alignSelf: "stretch", backgroundColor: c.hairline, marginLeft: margin, marginRight: margin }} />;
}

export function Btn({
  label,
  icon,
  fill,
  round,
  onPress,
  testID,
  grow,
}: {
  label?: string;
  icon?: GlyphName;
  fill?: boolean;
  round?: boolean;
  onPress?: () => void;
  testID?: string;
  grow?: boolean;
}) {
  const c = useCard();
  const fg = fill ? c.onFill : c.ink;
  const style: ViewStyle = {
    height: round ? 30 : 26,
    ...(round ? { width: fill ? 60 : 30 } : { paddingLeft: 12, paddingRight: 12 }),
    ...(grow ? { flex: 1 } : {}),
    borderRadius: round ? 15 : 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: fill ? c.fill : "#00000000",
    ...(fill ? {} : { borderWidth: 1, borderColor: c.hairline }),
  };
  return (
    <View testID={testID} onPress={onPress} style={style}>
      {icon ? <Svg markup={glyph(icon)} size={round ? 13 : 11} color={fg} /> : null}
      {label ? (
        <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: "semibold", color: fg }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/** A private value on the lock screen: a form's blank, labelled with what it hides (EVENT, NOTE). */
export function Blank({ what, width }: { what?: string; width: number }) {
  const c = useCard();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 15 }}>
      {what ? <Text style={{ fontSize: 9.5, fontWeight: "semibold", color: c.tertiary }}>{what.toUpperCase()}</Text> : null}
      <View style={{ width, height: 1, marginBottom: 3, backgroundColor: c.tertiary }} />
    </View>
  );
}

/** Words that are the person's (an event, a note): a blank while the card is redacted. */
export function Private({ what, width, children }: { what: string; width: number; children: ReactNode }) {
  return useRedacted() ? <Blank what={what} width={width} /> : children;
}

/** How the "Now" tag breathes, where the host can (round five: one opacity loop, still under Reduce Motion). */
export const NOW_BREATH = { from: 0.4, to: 1, periodMs: 2000, fps: 4 } as const;

/** The "Now" tag on the card on air: vermilion, its words white; it breathes on a host that takes `pulse`. */
export function NowTag({ tally }: { tally: string }) {
  const { pulse } = useHostAbilities();
  return (
    <View
      testID="now-tag"
      {...(pulse ? { pulse: NOW_BREATH } : {})}
      style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 18, paddingLeft: 6, paddingRight: 8, borderRadius: 9, backgroundColor: tally }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFFFFF" }} />
      <Text style={{ fontSize: 10, fontWeight: "bold", color: "#FFFFFF" }}>NOW</Text>
    </View>
  );
}

/** A live item on standby: a hollow ring in the tertiary ink. */
export function Standby() {
  const c = useCard();
  return <View testID="standby" style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.3, borderColor: c.tertiary }} />;
}
