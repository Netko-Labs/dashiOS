/** The pieces every widget is printed from (round five's chrome.js): labels, words, the one number, buttons, rules and blanks. */

import { Svg, Text, View, type ViewStyle } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { type GlyphName, glyph } from "../shared/inks/index.ts";
import { useCard, useRedacted } from "./look.tsx";

/** A label: small capitals in the secondary ink ("LISBON"). Metal has no letter-spacing, so it is upper-cased only. */
export function Lab({ children, strong }: { children: string; strong?: boolean }) {
  const c = useCard();
  return (
    <Text numberOfLines={1} style={{ fontSize: 10.5, fontWeight: "semibold", color: strong ? c.ink : c.secondary }}>
      {children.toUpperCase()}
    </Text>
  );
}

export function Meta({ children }: { children: string }) {
  const c = useCard();
  return (
    <Text numberOfLines={1} style={{ fontSize: 11.5, color: c.tertiary }}>
      {children}
    </Text>
  );
}

/** A title line: 13, semibold, ink; one line with an ellipsis. */
export function Title({ children, size = 13, weight = "semibold" }: { children: string; size?: number; weight?: "semibold" | "500" | "normal" }) {
  const c = useCard();
  return (
    <Text numberOfLines={1} style={{ fontSize: size, fontWeight: weight, color: c.ink }}>
      {children}
    </Text>
  );
}

/** Body words: 12.5 in the secondary ink. */
export function Words({ children, lines = 1, ink }: { children: string; lines?: number; ink?: boolean }) {
  const c = useCard();
  return (
    <Text {...(lines === 1 ? { numberOfLines: 1 as const } : {})} style={{ fontSize: 12.5, lineHeight: 17, color: ink ? c.ink : c.secondary }}>
      {children}
    </Text>
  );
}

/**
 * The one number (role "value"): printed in the card's ink, its unit beside
 * it at max(14, 0.3 em) in the same ink, weight 400 (#12). Its weight follows
 * the value (#14: `weight` 0–1 → 300 to 500); Metal draws only Regular and
 * Medium, so 300 and 400 are Regular and 500 is Medium (docs: for-mirin.md).
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
  const medium = size >= 40 && weight >= 0.75;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <Text numberOfLines={1} style={{ fontSize: size, lineHeight: Math.round(size * 0.95), color: colour, ...(medium ? { fontWeight: "500" as const } : {}) }}>
        {value}
      </Text>
      {unit ? (
        <View style={{ marginLeft: 2, marginTop: Math.round(size * 0.06) }}>
          <Text style={{ fontSize: Math.max(14, size * 0.3), color: colour }}>{unit}</Text>
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
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 14, gap: 8 }}>
      {left}
      {right ?? null}
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

/** The "Now" tag on the card on air: vermilion, its words white. */
export function NowTag({ tally }: { tally: string }) {
  return (
    <View
      testID="now-tag"
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
