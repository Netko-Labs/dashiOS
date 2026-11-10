/**
 * The lock screen: @dashi/ui's LoginScreen with the lock's own rules. Enter
 * checks the password (the controller enforces the waits after misses); a
 * wrong one says so and clears the field.
 */

import { LoginScreen, type PowerAction } from "@dashi/ui";
import { type ReactNode, useEffect, useState } from "react";
import { formatLongDay, formatTimeBare, useClockPrefs } from "../../shared/time/clock.ts";
import type { Verdict } from "./attempts.ts";

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
}

const HINTS = { idle: "Enter your password", checking: "Checking…", wrong: "Wrong password. Try again.", waiting: "Wait a moment…" } as const;

export function LockScreen({ name, picture, onSubmit, waitMs, onPower }: LockScreenProps): ReactNode {
  const now = useNow();
  const clock = useClockPrefs();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<keyof typeof HINTS>("idle");

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
  };

  return (
    <LoginScreen
      day={formatLongDay(now, clock)}
      time={formatTimeBare(now, clock)}
      name={name}
      picture={picture}
      value={password}
      onChangeText={(text) => {
        setPassword(text);
        if (status === "wrong") setStatus("idle");
      }}
      onSubmit={() => void submit()}
      hint={HINTS[status]}
      error={status === "wrong"}
      {...(onPower ? { onPower } : {})}
    />
  );
}
