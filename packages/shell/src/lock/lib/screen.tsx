/**
 * The lock screen: @dashi/ui's LoginScreen with the lock's own rules. Enter
 * checks the password (the controller enforces the waits after misses); a
 * wrong one says so and clears the field. Round five's widgets sit round it
 * (widgets/lock.tsx): the stacked clock and its row, the side column, the
 * Now Bar. A press on a widget asks for the password first and says what it
 * will open ("Unlock to open Notes"), then does exactly that. Untouched for
 * a while it rests into Glance; any key or press wakes it.
 *
 * The cover (`cover`, on every other screen: D554) is quieter: the day and
 * the time, who is signing in and the field, as the login screen's; no
 * widgets, no power buttons, no Glance.
 */

import { LoginScreen, type PowerAction } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useState } from "react";
import { formatLongDay, formatTimeBare, useClockPrefs } from "../../shared/time/index.ts";
import {
  Glance,
  LockHead,
  LockSide,
  lockOpenerOf,
  NowBar,
  type Placement,
  usePlacements,
  useWidgetEnvFor,
  WidgetEnvProvider,
  widgetHub,
  widgetInfo,
} from "../../widgets/index.ts";
import type { Verdict } from "./attempts.ts";
import { unlockHint, useResting } from "./rest.ts";

export type LockPower = PowerAction;

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export interface LockScreenProps {
  name: string;
  /** The account picture, when the person chose one. */
  picture?: string;
  /** "right" when the password is (the screen then goes away); the controller enforces the waits. */
  onSubmit: (password: string) => Promise<Verdict>;
  /** Milliseconds to wait before the next try, after repeated misses. */
  waitMs: () => number;
  /** Sleep, restart, or shut down; without it there are no power buttons. */
  onPower?: (what: LockPower) => void;
  /** Another screen's: the field without the widgets (D554). */
  cover?: boolean;
}

const HINTS = { idle: "Enter your password", checking: "Checking…", wrong: "Wrong password. Try again.", waiting: "Wait a moment…" } as const;

export function LockScreen({ name, picture, onSubmit, waitMs, onPower, cover = false }: LockScreenProps): ReactNode {
  const now = useNow();
  const clock = useClockPrefs();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<keyof typeof HINTS>("idle");
  const [pending, setPending] = useState<{ label: string; run: () => void } | null>(null);
  const [touched, setTouched] = useState(0);
  const [resting, wake] = useResting(touched);
  const hub = widgetHub();
  const placements = usePlacements(hub);
  const env = useWidgetEnvFor(hub, { locked: true, placements, open: setPending, dark: true, lock: true });

  // A press on any card: its app, or the notification area, once the password is in.
  const press = (placement: Pick<Placement, "kind">): void => {
    setTouched((n) => n + 1);
    const opener = lockOpenerOf(placement, () => hub?.openArea());
    const name = widgetInfo(placement.kind)?.name ?? "it";
    setPending({ label: opener.where === "app" ? name : `${name} in Notifications`, run: opener.run });
  };

  const submit = async (): Promise<void> => {
    if ((status !== "idle" && status !== "wrong") || password === "") return;
    const wait = waitMs();
    if (wait > 0) {
      setStatus("waiting");
      await Bun.sleep(wait);
    }
    setStatus("checking");
    const verdict = await onSubmit(password);
    // Busy or still waiting: keep what was typed, try again on Enter.
    if (verdict === "busy" || verdict === "wait") {
      setStatus("idle");
      return;
    }
    setPassword("");
    setStatus(verdict === "right" ? "idle" : "wrong");
    // Unlocked: what the press asked for, and nothing else.
    if (verdict === "right" && pending) {
      pending.run();
      setPending(null);
    }
  };

  // One view at the root: Metal draws only a tree's first root, so Glance beside the login screen was never drawn (pass 50).
  return (
    <WidgetEnvProvider value={env}>
      <View testID="lock-screen" style={{ flex: 1 }}>
        <LoginScreen
          day={formatLongDay(now, clock)}
          time={formatTimeBare(now, clock)}
          name={name}
          picture={picture}
          value={password}
          onChangeText={(text) => {
            setTouched((n) => n + 1);
            setPassword(text);
            if (status === "wrong") setStatus("idle");
          }}
          onSubmit={() => void submit()}
          hint={status === "idle" ? unlockHint(pending, HINTS.idle) : HINTS[status]}
          error={status === "wrong"}
          {...(onPower ? { onPower } : {})}
          {...(cover
            ? {}
            : { head: <LockHead onPress={(kind) => press({ kind })} />, around: <LockSide placements={placements} onPress={press} />, above: <NowBar /> })}
        />
        {resting && !cover ? (
          <Glance
            onWake={() => {
              setTouched((n) => n + 1);
              wake();
            }}
          />
        ) : null}
      </View>
    </WidgetEnvProvider>
  );
}
