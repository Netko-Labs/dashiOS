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
 * the clock, who is signing in and the field, as the login screen's; no
 * widgets, no power buttons, no Glance. Both follow the person's mode, as
 * the widgets do (Q2, D671); the clock is the one clock (D670).
 */

import { LoginScreen, type PowerAction, useDark } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useState } from "react";
import { formatLongDay, useClockPrefs, usesHour24 } from "../../shared/time/index.ts";
import {
  Glance,
  LockHead,
  LockSide,
  lockOpenerOf,
  lockTime,
  NowBar,
  type Placement,
  useClockDisplay,
  usePlacements,
  useWidgetEnvFor,
  WidgetEnvProvider,
  type WidgetHub,
  widgetHub,
  widgetInfo,
} from "../../widgets/index.ts";
import type { Verdict } from "./attempts.ts";
import { unlockHint, useResting } from "./rest.ts";

export type LockPower = PowerAction;

/** The clock reads the time this often. */
const TICK_MS = 1000;

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
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

type Pending = { label: string; run: () => void } | null;

/** The lock's day and clock, and its look: the person's mode (Q2, D671) and the clock's face (D670). */
function useLockFace(): { day: string; time: string; mode: "light" | "dark"; display: boolean } {
  const now = useNow();
  const clock = useClockPrefs();
  const dark = useDark();
  const display = useClockDisplay();
  return { day: formatLongDay(now, clock), time: lockTime(now.getTime(), usesHour24(clock)), mode: dark ? "dark" : "light", display };
}

/** A press on any card: its app, or the notification area, once the password is in. */
function presser(hub: WidgetHub | null, touch: () => void, setPending: (pending: Pending) => void): (placement: Pick<Placement, "kind">) => void {
  return (placement) => {
    touch();
    const opener = lockOpenerOf(placement, () => hub?.openArea());
    const name = widgetInfo(placement.kind)?.name ?? "it";
    setPending({ label: opener.where === "app" ? name : `${name} in Notifications`, run: opener.run });
  };
}

export function LockScreen({ name, picture, onSubmit, waitMs, onPower, cover = false }: LockScreenProps): ReactNode {
  const face = useLockFace();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<keyof typeof HINTS>("idle");
  const [pending, setPending] = useState<Pending>(null);
  const [touched, setTouched] = useState(0);
  const [resting, wake] = useResting(touched);
  const hub = widgetHub();
  const placements = usePlacements(hub);
  // The widgets take the lock's mode too; the login screen stays Dark.
  const env = useWidgetEnvFor(hub, { locked: true, placements, open: setPending, dark: face.mode === "dark", lock: true });
  const press = presser(hub, () => setTouched((n) => n + 1), setPending);

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
          {...face}
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
            : {
                head: <LockHead day={face.day} onPress={(kind) => press({ kind })} />,
                around: <LockSide placements={placements} onPress={press} />,
                above: <NowBar />,
              })}
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
