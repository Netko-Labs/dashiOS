/**
 * The screen you sign in on: the lock screen and the login screen (greeter)
 * are both this. The day and the clock (the Inks' clock, hours over minutes:
 * TY-1, D670) over the wallpaper, who is signing in, one field, a line
 * under it saying how it went, and along the bottom Sleep, Restart, and
 * Shut Down, as a Mac's login window has them. Each power button asks for a
 * second click, so a stray one cannot turn the machine off. Tab goes from
 * the field to each of them (and to what the host puts above and below the
 * field), in the purple ring.
 *
 * The login screen is always Dark's look: nobody has signed in to choose.
 * The lock follows the person's mode (`mode`, the owner's Q2, D671).
 *
 * It only shows: what the field means, checking it, and what power does are
 * the host's (the shell's lock controller, the greeter's greetd login).
 */

import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useState } from "react";
import { RESTART, SHUT_DOWN, SLEEP } from "./glyphs.ts";
import { ClockHead } from "./inks-clock.tsx";
import { Avatar } from "./login-parts.tsx";
import { LOGIN, type LoginColors, loginColors } from "./theme/colors.ts";
import { pill, RADIUS, SPACE, TYPE, WEIGHT } from "./theme/measures.ts";

/** The login screen's ground: the wallpaper darkened toward true black (the compositor draws it behind). */
export const LOGIN_GROUND = LOGIN.ground;
/** The focus ring on the login screen's dark ground, whatever Dark Mode is (KB-2): the dark palette's purple. */
export const LOGIN_FOCUS_RING = LOGIN.focusRing;
/** Its words: Dark's ink, and 70% of it for the day and the hints. */
export const LOGIN_INK = LOGIN.ink;
export const LOGIN_MUTED = LOGIN.muted;

export type PowerAction = "sleep" | "restart" | "shutdown";

const POWER: readonly { what: PowerAction; label: string; confirm: string; glyph: string }[] = [
  { what: "sleep", label: "Sleep", confirm: "Click to Sleep", glyph: SLEEP },
  { what: "restart", label: "Restart", confirm: "Click to Restart", glyph: RESTART },
  { what: "shutdown", label: "Shut Down", confirm: "Click to Shut Down", glyph: SHUT_DOWN },
];

/**
 * The screen's own measures. The field: a control's height, wide enough for
 * a long password's dots. A power button: room for "Click to Shut Down" on
 * one line, the buttons 132 apart, center to center; its circle and glyph.
 */
export const LOGIN_SCREEN = {
  field: { width: 220, height: 28 },
  power: { width: 116, circle: 40, glyph: 18 },
} as const;

/** How long a power button waits for its second click. */
const CONFIRM_MS = 3000;

export interface LoginScreenProps {
  /** The clock, formatted by the host ("Sunday, November 1", "5:04"). */
  day: string;
  time: string;
  /** Who is signing in. */
  name: string;
  /** Their account picture (an absolute path); initials without one. */
  picture?: string;
  /** The field: its text, and what it asks for. */
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** Hide what is typed (a password); default true. */
  secure?: boolean;
  /** The line under the field; `error` paints it as a failure. */
  hint: string;
  error?: boolean;
  /** Over the name: a way back to choosing someone else, for one. */
  above?: ReactNode;
  /** Under the hint: a session picker, for one. */
  below?: ReactNode;
  /** Sleep, restart, or shut down; without it there are no power buttons. */
  onPower?: (what: PowerAction) => void;
  /** In place of the day and the clock: the lock screen's own head, with its widgets under the clock. */
  head?: ReactNode;
  /** Drawn over the whole screen, behind nothing it covers: the lock screen's side column. */
  around?: ReactNode;
  /** Dark's look (the login screen, always) or Light's (the lock, in Light Mode). */
  mode?: "light" | "dark";
  /** The host draws Inter Display and the light weights: the clock in ExtraLight, else Regular. */
  display?: boolean;
}

export function LoginScreen(props: LoginScreenProps): ReactNode {
  const { day, time, name, picture, hint, error, above, below, onPower, head, around, mode = "dark", display = false } = props;
  const colors = loginColors(mode);
  const [arming, setArming] = useState<PowerAction | null>(null);
  useEffect(() => {
    if (!arming) return;
    const timer = setTimeout(() => setArming(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [arming]);
  const press = (what: PowerAction): void => {
    if (arming !== what) return setArming(what);
    setArming(null);
    onPower?.(what);
  };

  return (
    <View
      testID="login-screen"
      style={{ flex: 1, flexDirection: "column", alignItems: "center", backgroundColor: colors.ground, focusRingColor: colors.focusRing }}
    >
      {around}
      {head ?? <ClockHead day={day} time={time} ink={colors.ink} display={display} testID="login-head" />}
      <View style={{ flex: 1, minHeight: SPACE.page }} />
      <View style={{ flexDirection: "column", alignItems: "center", gap: SPACE.gap }}>
        {above}
        <Avatar name={name} picture={picture} colors={colors} />
        <Text style={{ fontSize: TYPE.heading.size, fontWeight: WEIGHT.semibold, color: colors.ink }}>{name}</Text>
        <Field {...props} colors={colors} />
        <Text style={{ fontSize: TYPE.secondary.size, color: error ? colors.wrong : colors.muted }}>{hint}</Text>
        {below}
      </View>
      {/* In the flow, not pinned: on a short screen the buttons move down instead of over the field. */}
      <View style={{ flex: 0.6, minHeight: SPACE.xl }} />
      {onPower && <PowerRow arming={arming} press={press} colors={colors} />}
    </View>
  );
}

/** The one field: a control's height, a pill, its 1 px edge turning the focus ring while it has the keyboard (KB-2). */
function Field({ value, onChangeText, onSubmit, placeholder = "Password", secure = true, colors }: LoginScreenProps & { colors: LoginColors }): ReactNode {
  const { width, height } = LOGIN_SCREEN.field;
  return (
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
        width,
        height,
        // One line in a set height takes padding at its sides only; paddingLeft and paddingRight need a newer host.
        padding: SPACE.button,
        borderRadius: pill(height),
        backgroundColor: colors.field,
        borderColor: colors.fieldEdge,
        focusBorderColor: colors.focusRing,
        fontSize: TYPE.body.size,
        color: colors.ink,
        placeholderColor: colors.muted,
      }}
    />
  );
}

/** Sleep, Restart and Shut Down along the bottom, each asking for a second click. */
function PowerRow({ arming, press, colors }: { arming: PowerAction | null; press: (what: PowerAction) => void; colors: LoginColors }): ReactNode {
  const { width, circle, glyph: glyphSize } = LOGIN_SCREEN.power;
  return (
    <View testID="login-power" style={{ marginBottom: SPACE.xl, flexDirection: "row", justifyContent: "center", gap: SPACE.page }}>
      {POWER.map(({ what, label, confirm, glyph }) => (
        // Tab reaches each after the field, and Space or Return presses it: the first press arms it, as a click does.
        <View
          key={what}
          testID={`login-${what}`}
          focusable
          accessibilityRole="button"
          accessibilityLabel={arming === what ? confirm : label}
          onPress={() => press(what)}
          style={{ flexDirection: "column", alignItems: "center", gap: SPACE.s, width, paddingVertical: SPACE.xs, borderRadius: RADIUS.sheet }}
        >
          <View
            style={{
              width: circle,
              height: circle,
              borderRadius: pill(circle),
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: arming === what ? colors.buttonHeld : colors.button,
            }}
          >
            <Svg markup={glyph} size={glyphSize} color={colors.ink} />
          </View>
          <Text style={{ fontSize: TYPE.caption.size, color: arming === what ? colors.ink : colors.muted }}>{arming === what ? confirm : label}</Text>
        </View>
      ))}
    </View>
  );
}
