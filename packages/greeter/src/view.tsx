/**
 * The login screen: pick who (when there is more than one person), then
 * @dashi/ui's LoginScreen with what greetd asks, and under it the session to
 * start. The clock ticks every second.
 */

import { Avatar, LOGIN_FOCUS_RING, LOGIN_GROUND, LOGIN_INK, LOGIN_MUTED, LoginScreen, type PowerAction } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { formatDay, formatTime } from "./clock.ts";
import type { LoginState } from "./greetd/index.ts";
import type { Session } from "./sessions.ts";
import type { User } from "./users.ts";

const TEXT = LOGIN_INK;
const MUTED = LOGIN_MUTED;

export interface LoginStore {
  subscribe(listener: () => void): () => void;
  get(): LoginState;
  begin(user: User, session: Session): void;
  choose(session: Session): void;
  answer(text: string): void;
}

export interface GreeterProps {
  users: User[];
  sessions: Session[];
  initialUser: User | null;
  initialSession: Session;
  login: LoginStore;
  onPower: (what: PowerAction) => void;
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The line under the field for each moment of a login. */
export function hintFor(state: LoginState, session: Session): { hint: string; error: boolean } {
  switch (state.kind) {
    case "idle":
      return { hint: "", error: false };
    case "prompt":
      if (state.wrong) return { hint: state.secret ? "Wrong password. Try again." : "That didn't work. Try again.", error: true };
      return { hint: state.notice ?? (state.secret ? "Enter your password" : state.message), error: false };
    case "checking":
      return { hint: "Checking…", error: false };
    case "started":
      return { hint: `Starting ${session.name}…`, error: false };
    case "error":
      return { hint: `${state.message} Press Return to try again.`, error: true };
  }
}

export function Greeter({ users, sessions, initialUser, initialSession, login, onPower }: GreeterProps): ReactNode {
  const now = useNow();
  const state = useSyncExternalStore(login.subscribe, login.get);
  const [user, setUser] = useState<User | null>(initialUser);
  const [session, setSession] = useState<Session>(initialSession);
  const [value, setValue] = useState("");

  // A new person starts a new login; a new session is only `choose`n, so `session` is not a dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (user) login.begin(user, session);
  }, [user, login]);

  const day = formatDay(now);
  const time = formatTime(now);

  if (!user) return <UserPicker day={day} time={time} users={users} onPick={setUser} />;

  const { hint, error } = hintFor(state, session);
  const nextSession = (): void => {
    const next = sessions[(sessions.indexOf(session) + 1) % sessions.length] ?? session;
    setSession(next);
    login.choose(next);
  };
  return (
    <LoginScreen
      day={day}
      time={time}
      name={user.displayName}
      picture={user.picture}
      value={value}
      onChangeText={setValue}
      onSubmit={() => {
        if (state.kind === "error") return login.begin(user, session);
        if (state.kind !== "prompt") return;
        login.answer(value);
        setValue("");
      }}
      placeholder={state.kind === "prompt" ? state.message : "Password"}
      secure={state.kind !== "prompt" || state.secret}
      hint={hint}
      error={error}
      above={
        users.length > 1 ? (
          <View
            testID="greeter-other-users"
            focusable
            accessibilityRole="button"
            onPress={() => setUser(null)}
            style={{ marginBottom: 6, paddingHorizontal: 6, borderRadius: 6 }}
          >
            <Text style={{ fontSize: 12, color: MUTED }}>‹ Other Users</Text>
          </View>
        ) : undefined
      }
      below={
        sessions.length > 1 ? (
          <View
            testID="greeter-session"
            focusable
            accessibilityRole="button"
            accessibilityLabel={`Session: ${session.name}`}
            onPress={nextSession}
            style={{ marginTop: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: "#ffffff1a" }}
          >
            <Text style={{ fontSize: 12, color: MUTED }}>{session.name}</Text>
          </View>
        ) : undefined
      }
      onPower={onPower}
    />
  );
}

/** What the screens without the login form show: the time, dimmed like the form's. */
export function Backdrop(): ReactNode {
  const now = useNow();
  return (
    <View style={{ flex: 1, flexDirection: "column", alignItems: "center", backgroundColor: LOGIN_GROUND }}>
      <View style={{ marginTop: 90, flexDirection: "column", alignItems: "center", gap: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: "semibold", color: MUTED }}>{formatDay(now)}</Text>
        <Text style={{ fontSize: 88, fontWeight: "bold", color: TEXT }}>{formatTime(now)}</Text>
      </View>
    </View>
  );
}

function UserPicker(props: { day: string; time: string; users: User[]; onPick: (user: User) => void }): ReactNode {
  const { day, time, users, onPick } = props;
  return (
    <View
      testID="greeter-users"
      style={{ flex: 1, flexDirection: "column", alignItems: "center", backgroundColor: LOGIN_GROUND, focusRingColor: LOGIN_FOCUS_RING }}
    >
      <View style={{ marginTop: 90, flexDirection: "column", alignItems: "center", gap: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: "semibold", color: MUTED }}>{day}</Text>
        <Text style={{ fontSize: 88, fontWeight: "bold", color: TEXT }}>{time}</Text>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ marginBottom: 140, flexDirection: "row", gap: 32 }}>
        {users.length === 0 ? (
          <Text style={{ fontSize: 14, color: MUTED }}>No one can log in on this computer.</Text>
        ) : (
          users.map((user) => (
            <View
              key={user.name}
              testID={`greeter-user-${user.name}`}
              focusable
              accessibilityRole="button"
              onPress={() => onPick(user)}
              style={{ flexDirection: "column", alignItems: "center", gap: 10, width: 110, paddingVertical: 6, borderRadius: 12 }}
            >
              <Avatar name={user.displayName} picture={user.picture} size={72} />
              <Text style={{ fontSize: 14, fontWeight: "semibold", color: TEXT }}>{user.displayName}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
