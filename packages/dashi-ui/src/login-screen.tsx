/**
 * The screen you sign in on: the lock screen and the login screen (greeter)
 * are both this. It is the split screen (login-split.tsx, lock-v3 C and
 * #narrow, LK-1 to LK-5) on every screen size: the day and the clock (hours
 * over minutes, D670) at the left edge, who is signing in, one field, a line
 * under it saying how it went, and Sleep, Restart and Shut Down, each asking
 * for a second click so a stray one cannot turn the machine off; on the lock
 * where the person is, Today. Tab goes from the field to Today and then to
 * the power pills, in the purple ring.
 *
 * The login screen is always Dark's look: nobody has signed in to choose.
 * The lock follows the person's mode (`mode`, the owner's Q2, D671).
 *
 * It only shows: what the field means, checking it, and what power does are
 * the host's (the shell's lock controller, the greeter's greetd login).
 */

import { View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useState } from "react";
import type { TodayPlace } from "./lock-layout.ts";
import { SplitLogin, useVeil } from "./login-split.tsx";
import { WhoSignsIn } from "./login-who.tsx";
import { LOGIN, loginColors } from "./theme/colors.ts";

/** The login screen's ground: the wallpaper darkened toward true black (the compositor draws it behind). */
export const LOGIN_GROUND = LOGIN.ground;
/** The focus ring on the login screen's dark ground, whatever Dark Mode is (KB-2): the dark palette's purple. */
export const LOGIN_FOCUS_RING = LOGIN.focusRing;
/** Its words: Dark's ink, and 70% of it for the day and the hints. */
export const LOGIN_INK = LOGIN.ink;
export const LOGIN_MUTED = LOGIN.muted;

export type PowerAction = "sleep" | "restart" | "shutdown";

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
  /** Dark's look (the login screen, always) or Light's (the lock, in Light Mode). */
  mode?: "light" | "dark";
  /** The host draws Inter Display and the light weights: the clock in ExtraLight, else Regular. */
  display?: boolean;
  /** Today, drawn for its place (lock-layout.ts): the lock's, where the person is. */
  today?: (place: TodayPlace) => ReactNode;
}

/** Sleep, Restart and Shut Down ask for a second click within `CONFIRM_MS`: which one is armed, and a press. */
function usePowerArming(onPower: ((what: PowerAction) => void) | undefined): [PowerAction | null, (what: PowerAction) => void] {
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
  return [arming, press];
}

export function LoginScreen(props: LoginScreenProps): ReactNode {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [arming, press] = usePowerArming(props.onPower);
  const mode = props.mode ?? "dark";
  const colors = loginColors(mode);
  const display = props.display ?? false;
  const veil = useVeil(mode);
  const who = (
    <WhoSignsIn
      {...props}
      display={display}
      colors={colors}
      placeholder={props.placeholder ?? "Password"}
      secure={props.secure ?? true}
      error={props.error ?? false}
    />
  );
  // One root: the ground, the ring's colour and the veil (LK-4); its size says where everything goes.
  return (
    <View
      testID="login-screen"
      onLayout={(bounds) => setSize({ width: bounds.width, height: bounds.height })}
      {...veil}
      style={{ flex: 1, backgroundColor: colors.ground, focusRingColor: colors.focusRing }}
    >
      {size.width > 0 ? (
        <SplitLogin
          bare
          day={props.day}
          time={props.time}
          display={display}
          colors={colors}
          width={size.width}
          height={size.height}
          who={who}
          {...(props.today ? { today: props.today } : {})}
          arming={arming}
          {...(props.onPower ? { press } : {})}
        />
      ) : null}
    </View>
  );
}
