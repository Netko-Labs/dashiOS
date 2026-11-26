/**
 * The split sign-in screen (lock-v3 C · Split and #narrow, LK-1 to LK-5, decisions.md D803, D806), on a
 * screen of any size: time at the left edge and, on the lock where the person is, Today. Where each thing
 * goes is `lockLayout`'s (lock-layout.ts): a 744 pane on a wide screen, a narrower pane on a smaller
 * landscape one, a bottom sheet on a screen taller than wide. The left half is the day and the clock
 * (`LockClock`), who signs in (`WhoSignsIn`, login-who.tsx) and Sleep, Restart and Shut Down as thin-glass
 * pills (at its foot, or beside who signs in on a vertical screen). The login screen, the lock's other
 * screens and Glance draw this half alone, at the same place (LK-3, MS-6).
 *
 * The whole screen is the veil (`material: "veil"`: the wallpaper frosted, LK-4) where the host draws
 * glass, over the lock's own wash, which is what shows where it doesn't (GL-3). Tab goes to the field
 * first, then Today, then the pills (LK-5): the tree is in that order, each placed where it goes.
 */

import { Svg, Text, useWindowGlass, View } from "@mirinjs/metal";
import { createContext, type ReactNode } from "react";
import { Frosted, GlassLayer } from "./frosted.tsx";
import { RESTART, SHUT_DOWN, SLEEP } from "./glyphs.ts";
import { LockClock } from "./inks-clock.tsx";
import { type LockLayout, lockLayout, type TodayPlace } from "./lock-layout.ts";
import { LOGIN_LIGHT, type LoginColors } from "./theme/colors.ts";
import { GLASS } from "./theme/glass.ts";
import { Appearance, useSessionDark } from "./theme/index.ts";
import { pill, SPACE, TYPE, WEIGHT } from "./theme/measures.ts";

export type SplitPower = "sleep" | "restart" | "shutdown";

const PILLS: readonly { what: SplitPower; label: string; confirm: string; glyph: string }[] = [
  { what: "sleep", label: "Sleep", confirm: "Click to Sleep", glyph: SLEEP },
  { what: "restart", label: "Restart", confirm: "Click to Restart", glyph: RESTART },
  { what: "shutdown", label: "Shut Down", confirm: "Click to Shut Down", glyph: SHUT_DOWN },
];

/** Inside the split screen: the login parts wear Frost there (avatars regular, the session chip thin: LK-3). */
export const InSplit = createContext(false);

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
  /** The screen's size in points: where everything goes (`lockLayout`). */
  width: number;
  height: number;
  /** Who signs in: the row (`WhoSignsIn`), the greeter's people, or nothing (Glance). */
  who?: ReactNode;
  /** Today, where the person is: drawn for its place (a pane or a sheet). */
  today?: (place: TodayPlace) => ReactNode;
  /** The power pills, armed one, and what a press does; none without `press`. */
  arming?: SplitPower | null;
  press?: (what: SplitPower) => void;
  testID?: string;
  /** Inside a root that already is the ground and the veil (LoginScreen's): no ground of its own. */
  bare?: boolean;
}

/**
 * The veil where the host draws glass (LK-4), over the ground that shows where it doesn't (GL-3). The
 * compositor draws glass in the session's mode, so a screen in the other mode (the login screen is
 * always Dark) keeps its wash, as `Frosted` gives its twin there.
 */
export function useVeil(mode: "light" | "dark"): { material?: "veil" } {
  const glass = useWindowGlass().available;
  const inMode = (mode === "dark") === useSessionDark();
  return glass && inMode ? { material: "veil" } : {};
}

export function SplitLogin(props: SplitLoginProps): ReactNode {
  const { colors, bare = false, testID = "login-screen", press, arming = null } = props;
  const veil = useVeil(colors === LOGIN_LIGHT ? "light" : "dark");
  const layout = lockLayout(props.width, props.height);
  return (
    // Its glass and inks in the screen's own mode: the login screen is Dark in any session (LK-3).
    <Appearance dark={colors !== LOGIN_LIGHT}>
      {/* The veil is the first glass layer: Today's the second, its cards the third (GL-2). */}
      <GlassLayer>
        <View {...(bare ? {} : { testID, ...veil })} style={{ flex: 1, ...(bare ? {} : { backgroundColor: colors.ground, focusRingColor: colors.focusRing }) }}>
          <View testID="lock-half" style={{ position: "absolute", left: layout.inset, top: layout.top }}>
            <LockClock day={props.day} time={props.time} ink={colors.ink} display={props.display} clock={layout.clock} testID="lock-clock" />
          </View>
          <View style={{ position: "absolute", left: layout.inset, top: layout.who.top }}>
            <InSplit.Provider value>{props.who}</InSplit.Provider>
          </View>
          {props.today ? <TodaySlot layout={layout}>{props.today(layout.today)}</TodaySlot> : null}
          {press ? <PowerPills layout={layout} arming={arming} press={press} colors={colors} /> : null}
        </View>
      </GlassLayer>
    </Appearance>
  );
}

/** Where Today goes: the full height at the right (a pane), or along the foot (a sheet, as tall as it is). */
function TodaySlot({ layout, children }: { layout: LockLayout; children: ReactNode }) {
  const place = layout.today;
  const style =
    place.kind === "pane"
      ? ({ position: "absolute", top: 0, right: 0, bottom: 0, width: place.width } as const)
      : ({ position: "absolute", left: 0, right: 0, bottom: 0 } as const);
  return (
    <View testID="lock-today-slot" style={style}>
      {children}
    </View>
  );
}

/**
 * Sleep, Restart and Shut Down (LK-1): thin-glass pills, each asking for a second click; at the left half's
 * foot, or beside who signs in at the right on a vertical screen (the sheet takes the foot).
 */
function PowerPills({
  layout,
  arming,
  press,
  colors,
}: {
  layout: LockLayout;
  arming: SplitPower | null;
  press: (what: SplitPower) => void;
  colors: LoginColors;
}) {
  const { height, glyph, padding } = GLASS.lock.pill;
  return (
    <View testID="login-power" style={{ position: "absolute", ...layout.power, flexDirection: "row", gap: SPACE.m }}>
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
