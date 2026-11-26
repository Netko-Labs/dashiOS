/**
 * The split sign-in screen (lock-v3 C · Split, LK-1 to LK-5, decisions.md D803): on a screen at least
 * `GLASS.lock.splitMin` wide, time at the left edge and, on the lock where the person is, Today on the
 * right. The left half is the day and the clock (`LockClock`), who signs in (the initials on regular
 * glass, the name, a 280 field of regular glass with its go arrow, the hint) and Sleep, Restart and
 * Shut Down as thin-glass pills at its foot. The login screen, the lock's other screens and Glance draw
 * this half alone, at the same place (LK-3, MS-6).
 *
 * The whole screen is the veil (`material: "veil"`: the wallpaper frosted, LK-4) where the host draws
 * glass, over the lock's own wash, which is what shows where it doesn't (GL-3). Tab goes to the field
 * first, then Today's cards, then the pills (LK-5): the pills come last in the tree, drawn at the foot.
 */

import { Svg, Text, TextInput, useWindowGlass, View } from "@mirinjs/metal";
import { createContext, type ReactNode } from "react";
import { Frosted } from "./frosted.tsx";
import { CHEVRON_RIGHT, RESTART, SHUT_DOWN, SLEEP } from "./glyphs.ts";
import { LockClock } from "./inks-clock.tsx";
import { Picture } from "./picture.tsx";
import type { LoginColors } from "./theme/colors.ts";
import { CLEAR } from "./theme/colors.ts";
import { GLASS } from "./theme/glass.ts";
import { pill, SPACE, TYPE, WEIGHT } from "./theme/measures.ts";

export type SplitPower = "sleep" | "restart" | "shutdown";

const PILLS: readonly { what: SplitPower; label: string; confirm: string; glyph: string }[] = [
  { what: "sleep", label: "Sleep", confirm: "Click to Sleep", glyph: SLEEP },
  { what: "restart", label: "Restart", confirm: "Click to Restart", glyph: RESTART },
  { what: "shutdown", label: "Shut Down", confirm: "Click to Shut Down", glyph: SHUT_DOWN },
];

/** Inside the split screen: the login parts wear Frost there (avatars regular, the session chip thin: LK-3). */
export const InSplit = createContext(false);

/** Whether a screen this wide is split (LK-1); a narrower one keeps the centred column for now (D803). */
export const isSplitWidth = (width: number): boolean => width >= GLASS.lock.splitMin;

/** How far in from the left edge the half sits on a screen this wide (LK-2). */
export const splitInset = (width: number): number => (width >= 1920 ? GLASS.lock.insetWide : GLASS.lock.inset);

/** A person's initials: the first letters of their first two words ("Alex Kim" → "AK"). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => (word[0] ?? "").toLocaleUpperCase())
      .join("") || "?"
  );
}

export interface SplitLoginProps {
  day: string;
  time: string;
  display: boolean;
  colors: LoginColors;
  /** The screen's width, for the inset. */
  width: number;
  /** Who signs in: the row (`WhoSignsIn`), the greeter's people, or nothing (Glance). */
  who?: ReactNode;
  /** The right side: the lock's Today, where the person is. */
  today?: ReactNode;
  /** The power pills, armed one, and what a press does; none without `press`. */
  arming?: SplitPower | null;
  press?: (what: SplitPower) => void;
  testID?: string;
  /** Inside a root that already is the ground and the veil (LoginScreen's): no ground of its own. */
  bare?: boolean;
}

/** The veil where the host draws glass (LK-4), over the ground that shows where it doesn't (GL-3). */
export function useVeil(): { material?: "veil" } {
  return useWindowGlass().available ? { material: "veil" } : {};
}

export function SplitLogin({
  day,
  time,
  display,
  colors,
  width,
  who,
  today,
  arming = null,
  press,
  testID = "login-screen",
  bare = false,
}: SplitLoginProps): ReactNode {
  const veil = useVeil();
  const inset = splitInset(width);
  return (
    <View
      {...(bare ? {} : { testID, ...veil })}
      style={{ flex: 1, flexDirection: "row", ...(bare ? {} : { backgroundColor: colors.ground, focusRingColor: colors.focusRing }) }}
    >
      <View testID="lock-half" style={{ flex: 1, flexDirection: "column", paddingLeft: inset, paddingTop: GLASS.lock.top }}>
        <LockClock day={day} time={time} ink={colors.ink} display={display} testID="lock-clock" />
        <View style={{ flex: 1, minHeight: SPACE.xl }} />
        <View style={{ height: GLASS.lock.footer }}>
          <InSplit.Provider value>{who}</InSplit.Provider>
        </View>
      </View>
      {today ? <View style={{ width: GLASS.lock.today }}>{today}</View> : null}
      {press ? <PowerPills inset={inset} arming={arming} press={press} colors={colors} /> : null}
    </View>
  );
}

export interface WhoSignsInProps {
  name: string;
  picture?: string | undefined;
  display: boolean;
  colors: LoginColors;
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  secure: boolean;
  hint: string;
  error: boolean;
  above?: ReactNode;
  below?: ReactNode;
}

/** Who signs in (LK-1): the initials (52) or picture, the name over the field, the hint under them. */
export function WhoSignsIn(props: WhoSignsInProps): ReactNode {
  const { name, picture, display, colors, hint, error, above, below } = props;
  const size = GLASS.lock.initials;
  const initials = (
    <Frosted level="regular" style={{ width: size, height: size, borderRadius: pill(size), alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: TYPE.title.size, fontWeight: WEIGHT.semibold, color: colors.ink, ...(display ? { fontFamily: "display" } : {}) }}>
        {initialsOf(name)}
      </Text>
    </Frosted>
  );
  return (
    <View testID="lock-who" style={{ flexDirection: "column", alignItems: "flex-start", gap: SPACE.gap }}>
      {above}
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.button }}>
        {picture ? (
          <Picture source={picture} resizeMode="cover" style={{ width: size, height: size, borderRadius: pill(size) }} fallback={initials} />
        ) : (
          initials
        )}
        <View style={{ flexDirection: "column", gap: SPACE.xs }}>
          <Text style={{ fontSize: TYPE.heading.size, fontWeight: WEIGHT.semibold, color: colors.ink }}>{name}</Text>
          <GlassField {...props} />
        </View>
      </View>
      <Text style={{ fontSize: TYPE.secondary.size, color: error ? colors.wrong : colors.muted }}>{hint}</Text>
      {below}
    </View>
  );
}

/** The field (LK-1): regular glass, a pill `GLASS.lock.field` wide, the go arrow an ink disc at its end. */
function GlassField({ value, onChangeText, onSubmit, placeholder, secure, colors }: WhoSignsInProps): ReactNode {
  const height = GLASS.lock.pill.height;
  const arrow = GLASS.lock.arrow;
  return (
    <Frosted level="regular" style={{ width: GLASS.lock.field, height, borderRadius: pill(height), flexDirection: "row", alignItems: "center" }}>
      <TextInput
        testID="login-field"
        value={value}
        autoFocus
        secureTextEntry={secure}
        placeholder={placeholder}
        accessibilityLabel={placeholder}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        style={{
          flex: 1,
          height,
          padding: SPACE.button,
          borderRadius: pill(height),
          backgroundColor: CLEAR,
          borderColor: CLEAR,
          focusBorderColor: colors.focusRing,
          fontSize: TYPE.body.size,
          color: colors.ink,
          placeholderColor: colors.muted,
        }}
      />
      <View
        testID="login-go"
        accessibilityRole="button"
        accessibilityLabel="Unlock"
        onPress={onSubmit}
        style={{
          position: "absolute",
          right: SPACE.xs,
          width: arrow,
          height: arrow,
          borderRadius: pill(arrow),
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.ink,
        }}
      >
        <Svg markup={CHEVRON_RIGHT} size={TYPE.caption.size} color={colors.onInk} />
      </View>
    </Frosted>
  );
}

/** Sleep, Restart and Shut Down (LK-1): thin-glass pills at the half's foot, each asking for a second click. */
function PowerPills({ inset, arming, press, colors }: { inset: number; arming: SplitPower | null; press: (what: SplitPower) => void; colors: LoginColors }) {
  const { height, glyph, padding } = GLASS.lock.pill;
  return (
    <View testID="login-power" style={{ position: "absolute", left: inset, bottom: GLASS.lock.powerBottom, flexDirection: "row", gap: SPACE.m }}>
      {PILLS.map(({ what, label, confirm, glyph: markup }) => (
        <Frosted
          key={what}
          level="thin"
          testID={`login-${what}`}
          focusable
          accessibilityRole="button"
          accessibilityLabel={arming === what ? confirm : label}
          onPress={() => press(what)}
          style={{ height, paddingHorizontal: padding, borderRadius: pill(height), flexDirection: "row", alignItems: "center", gap: SPACE.s }}
        >
          {arming === what ? (
            <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderRadius: pill(height), backgroundColor: colors.buttonHeld }} />
          ) : null}
          <Svg markup={markup} size={glyph} color={colors.ink} />
          <Text style={{ fontSize: TYPE.panel.body.size, fontWeight: WEIGHT.semibold, color: colors.ink }}>{arming === what ? confirm : label}</Text>
        </Frosted>
      ))}
    </View>
  );
}
