/**
 * The screen you sign in on: the lock screen and the login screen (greeter)
 * are both this. The time and day over the wallpaper darkened toward true
 * black, who is signing in, one field, a line under it saying how it
 * went, and along the bottom Sleep, Restart, and Shut Down, as a Mac's login
 * window has them. Each power button asks for a second click, so a stray one
 * cannot turn the machine off.
 *
 * It only shows: what the field means, checking it, and what power does are
 * the host's (the shell's lock controller, the greeter's greetd login).
 */

import { Image, Svg, Text, TextInput, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useState } from "react";
import { RESTART, SHUT_DOWN, SLEEP } from "./glyphs.ts";
import { darkColors, TRUE_BLACK } from "./theme/palette.ts";

/**
 * The wallpaper shows through, darkened toward true black (the compositor
 * draws it behind). The login screen has one look, Dark's, whatever Dark
 * Mode is: the greeter runs before anyone's setting is known.
 */
export const LOGIN_GROUND = `${TRUE_BLACK.ground}b8`;
/** The focus ring on the login screen's dark ground, whatever Dark Mode is (KB-2): the dark palette's purple. */
export const LOGIN_FOCUS_RING = darkColors.focusRing;
/** Its words: Dark's ink, and 70% of it for the day and the hints. */
export const LOGIN_INK = TRUE_BLACK.ink;
export const LOGIN_MUTED = `${TRUE_BLACK.ink}b3`;
const BACKGROUND = LOGIN_GROUND;
const TEXT = LOGIN_INK;
const MUTED = LOGIN_MUTED;
const WRONG = "#ffb4b4";

export type PowerAction = "sleep" | "restart" | "shutdown";

const POWER: readonly { what: PowerAction; label: string; confirm: string; glyph: string }[] = [
  { what: "sleep", label: "Sleep", confirm: "Click to Sleep", glyph: SLEEP },
  { what: "restart", label: "Restart", confirm: "Click to Restart", glyph: RESTART },
  { what: "shutdown", label: "Shut Down", confirm: "Click to Shut Down", glyph: SHUT_DOWN },
];

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
}

export function LoginScreen(props: LoginScreenProps): ReactNode {
  const { day, time, name, picture, value, onChangeText, onSubmit, placeholder = "Password", secure = true, hint, error, above, below, onPower } = props;
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
    <View style={{ flex: 1, flexDirection: "column", alignItems: "center", backgroundColor: BACKGROUND, focusRingColor: LOGIN_FOCUS_RING }}>
      <View style={{ marginTop: 90, flexDirection: "column", alignItems: "center", gap: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: "semibold", color: MUTED }}>{day}</Text>
        <Text style={{ fontSize: 88, fontWeight: "bold", color: TEXT }}>{time}</Text>
      </View>
      <View style={{ flex: 1, minHeight: 16 }} />
      <View style={{ flexDirection: "column", alignItems: "center", gap: 10 }}>
        {above}
        <Avatar name={name} picture={picture} />
        <Text style={{ fontSize: 16, fontWeight: "semibold", color: TEXT }}>{name}</Text>
        <View style={{ width: 220, height: 32, paddingLeft: 14, paddingRight: 14, borderRadius: 16, backgroundColor: "#ffffff26", justifyContent: "center" }}>
          <TextInput
            value={value}
            autoFocus
            secureTextEntry={secure}
            placeholder={placeholder}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmit}
            style={{ fontSize: 14, color: TEXT, placeholderColor: MUTED, backgroundColor: "#00000000" }}
          />
        </View>
        <Text style={{ fontSize: 12, color: error ? WRONG : MUTED }}>{hint}</Text>
        {below}
      </View>
      {/* In the flow, not pinned: on a short screen the buttons move down instead of over the field. */}
      <View style={{ flex: 0.6, minHeight: 24 }} />
      {onPower && (
        <View testID="login-power" style={{ marginBottom: 28, flexDirection: "row", justifyContent: "center", gap: 36 }}>
          {POWER.map(({ what, label, confirm, glyph }) => (
            <View key={what} testID={`login-${what}`} onPress={() => press(what)} style={{ flexDirection: "column", alignItems: "center", gap: 6, width: 96 }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: arming === what ? "#ffffff59" : "#ffffff26",
                }}
              >
                <Svg markup={glyph} size={18} color={TEXT} />
              </View>
              <Text style={{ fontSize: 11, color: arming === what ? TEXT : MUTED }}>{arming === what ? confirm : label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** A person's initial in a circle (a picture, once accounts have them). */
export function Avatar({ name, picture, size = 64 }: { name: string; picture?: string; size?: number }): ReactNode {
  if (picture) return <Image source={picture} resizeMode="cover" style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#ffffff2e", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: Math.round(size * 0.44), fontWeight: "semibold", color: TEXT }}>{(name[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}
