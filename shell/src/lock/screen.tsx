/**
 * The lock screen: the time, who is locked out, and a password field, over
 * the wallpaper darkened to a deep evening color. Enter checks the password; a
 * wrong one says so and clears the field. Along the bottom, Sleep, Restart,
 * and Shut Down, as a Mac's login window has them; each asks for a second
 * click, so a stray one cannot turn the machine off.
 */

import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { formatLongDay, formatTimeBare, useClockPrefs } from "../clock.ts";
import type { Verdict } from "./attempts.ts";

/** The wallpaper shows through, darkened (the compositor draws it behind). */
const BACKGROUND = "#140e22b8";
const TEXT = "#f5f5f7";
const MUTED = "#f5f5f7b3";

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export type LockPower = "sleep" | "restart" | "shutdown";

const stroke = (d: string) => `<path d="${d}" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;

const POWER: readonly { what: LockPower; label: string; confirm: string; glyph: string }[] = [
  { what: "sleep", label: "Sleep", confirm: "Click to Sleep", glyph: svg(`<path d="M12.9 9.7A5.6 5.6 0 0 1 6.3 3.1a5.6 5.6 0 1 0 6.6 6.6z" fill="#000"/>`) },
  { what: "restart", label: "Restart", confirm: "Click to Restart", glyph: svg(stroke("M12.6 8.6A4.7 4.7 0 1 1 11.2 4.7") + stroke("M11.6 2.2v2.8H8.8")) },
  { what: "shutdown", label: "Shut Down", confirm: "Click to Shut Down", glyph: svg(stroke("M8 2.2v5.4") + stroke("M4.9 4.4a4.8 4.8 0 1 0 6.2 0")) },
];

/** How long a power button waits for its second click. */
const CONFIRM_MS = 3000;

export interface LockScreenProps {
  name: string;
  /** "right" when the password is (the screen then goes away); the controller enforces the waits. */
  onSubmit: (password: string) => Promise<Verdict>;
  /** Milliseconds to wait before the next try, after repeated misses. */
  waitMs: () => number;
  /** Sleep, restart, or shut down; without it there are no power buttons. */
  onPower?: (what: LockPower) => void;
}

export function LockScreen({ name, onSubmit, waitMs, onPower }: LockScreenProps) {
  const now = useNow();
  const clock = useClockPrefs();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "wrong" | "waiting">("idle");
  const [arming, setArming] = useState<LockPower | null>(null);
  useEffect(() => {
    if (!arming) return;
    const timer = setTimeout(() => setArming(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [arming]);
  const press = (what: LockPower) => {
    if (arming !== what) return setArming(what);
    setArming(null);
    onPower?.(what);
  };

  const submit = async () => {
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

  const hint = { idle: "Enter your password", checking: "Checking…", wrong: "Wrong password. Try again.", waiting: "Wait a moment…" }[status];

  return (
    <View style={{ flex: 1, flexDirection: "column", alignItems: "center", backgroundColor: BACKGROUND }}>
      <View style={{ marginTop: 90, flexDirection: "column", alignItems: "center", gap: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: "semibold", color: MUTED }}>{formatLongDay(now, clock)}</Text>
        <Text style={{ fontSize: 88, fontWeight: "bold", color: TEXT }}>{formatTimeBare(now, clock)}</Text>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ marginBottom: 110, flexDirection: "column", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: "#ffffff2e",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 28, fontWeight: "semibold", color: TEXT }}>{(name[0] ?? "?").toUpperCase()}</Text>
        </View>
        <Text style={{ fontSize: 16, fontWeight: "semibold", color: TEXT }}>{name}</Text>
        <View
          style={{
            width: 220,
            height: 32,
            paddingLeft: 14,
            paddingRight: 14,
            borderRadius: 16,
            backgroundColor: "#ffffff26",
            justifyContent: "center",
          }}
        >
          <TextInput
            value={password}
            autoFocus
            secureTextEntry
            placeholder="Password"
            onChangeText={(text) => {
              setPassword(text);
              if (status === "wrong") setStatus("idle");
            }}
            onSubmitEditing={() => void submit()}
            style={{ fontSize: 14, color: TEXT, placeholderColor: MUTED, backgroundColor: "#00000000" }}
          />
        </View>
        <Text style={{ fontSize: 12, color: status === "wrong" ? "#ffb4b4" : MUTED }}>{hint}</Text>
      </View>
      {onPower && (
        <View testID="lock-power" style={{ position: "absolute", bottom: 28, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 36 }}>
          {POWER.map(({ what, label, confirm, glyph }) => (
            <View key={what} testID={`lock-${what}`} onPress={() => press(what)} style={{ flexDirection: "column", alignItems: "center", gap: 6, width: 96 }}>
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
