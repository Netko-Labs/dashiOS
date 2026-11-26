/**
 * The login screen: pick who (when there is more than one person), then
 * @dashi/ui's LoginScreen with what greetd asks, and under it the session to
 * start. The clock ticks every second; it is the lock's clock (D670), and
 * the screen is Dark's look whatever anyone's mode (D671). On a screen at
 * least 1280 pt wide it is the split lock's left half alone (LK-3, D803),
 * over the veil; narrower, the centred column it was.
 */

import { ClockHead, isSplitWidth, LOGIN, LOGIN_PARTS, LoginBackLink, LoginChip, LoginPerson, LoginScreen, type PowerAction, SplitLogin, TYPE } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { formatDay, formatTime } from "./clock.ts";
import { useDisplay } from "./display.ts";
import type { LoginState } from "./greetd/index.ts";
import type { Session } from "./sessions.ts";
import type { User } from "./users.ts";

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
  const display = useDisplay();

  if (!user) return <UserPicker day={day} time={time} display={display} users={users} onPick={setUser} />;

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
      display={display}
      above={users.length > 1 ? <LoginBackLink testID="greeter-other-users" label="Other users" onPress={() => setUser(null)} /> : undefined}
      below={
        sessions.length > 1 ? (
          <LoginChip testID="greeter-session" label={session.name} accessibilityLabel={`Session: ${session.name}`} onPress={nextSession} />
        ) : undefined
      }
      onPower={onPower}
    />
  );
}

/** The screen's width, measured: the split at 1280 pt and up (LK-3), the centred column below. */
function useWidth(): [number, { onLayout: (bounds: { width: number }) => void; style: { flex: 1 } }] {
  const [width, setWidth] = useState(0);
  return [width, { onLayout: (bounds) => setWidth(bounds.width), style: { flex: 1 } }];
}

/** What the screens without the login form show: the day and the clock, on the form's ground; wide, the lock's left half alone (LK-3). */
export function Backdrop(): ReactNode {
  const now = useNow();
  const display = useDisplay();
  const [width, measured] = useWidth();
  return (
    <View {...measured}>
      {isSplitWidth(width) ? (
        <SplitLogin day={formatDay(now)} time={formatTime(now)} display={display} colors={LOGIN} width={width} testID="greeter-backdrop" />
      ) : (
        <View style={{ flex: 1, flexDirection: "column", alignItems: "center", backgroundColor: LOGIN.ground }}>
          <ClockHead day={formatDay(now)} time={formatTime(now)} ink={LOGIN.ink} display={display} />
        </View>
      )}
    </View>
  );
}

function UserPicker(props: { day: string; time: string; display: boolean; users: User[]; onPick: (user: User) => void }): ReactNode {
  const [width, measured] = useWidth();
  return <View {...measured}>{isSplitWidth(width) ? <SplitPicker {...props} width={width} /> : <ColumnPicker {...props} />}</View>;
}

/** Who signs in, chosen on the split screen: the people in a row where the field goes (LK-3). */
function SplitPicker(props: { day: string; time: string; display: boolean; users: User[]; onPick: (user: User) => void; width: number }): ReactNode {
  const { day, time, display, users, onPick, width } = props;
  return (
    <SplitLogin
      day={day}
      time={time}
      display={display}
      colors={LOGIN}
      width={width}
      testID="greeter-users"
      who={
        <View style={{ flexDirection: "row", gap: LOGIN_PARTS.pickerGap }}>
          <People users={users} onPick={onPick} />
        </View>
      }
    />
  );
}

function People({ users, onPick }: { users: User[]; onPick: (user: User) => void }): ReactNode {
  if (users.length === 0) return <Text style={{ fontSize: TYPE.body.size, color: LOGIN.muted }}>No one can log in on this computer.</Text>;
  return users.map((user) => (
    <LoginPerson key={user.name} testID={`greeter-user-${user.name}`} name={user.displayName} picture={user.picture} onPress={() => onPick(user)} />
  ));
}

function ColumnPicker(props: { day: string; time: string; display: boolean; users: User[]; onPick: (user: User) => void }): ReactNode {
  const { day, time, display, users, onPick } = props;
  return (
    <View
      testID="greeter-users"
      style={{ flex: 1, flexDirection: "column", alignItems: "center", backgroundColor: LOGIN.ground, focusRingColor: LOGIN.focusRing }}
    >
      <ClockHead day={day} time={time} ink={LOGIN.ink} display={display} />
      <View style={{ flex: 1 }} />
      <View style={{ marginBottom: LOGIN_PARTS.pickerBottom, flexDirection: "row", gap: LOGIN_PARTS.pickerGap }}>
        <People users={users} onPick={onPick} />
      </View>
    </View>
  );
}
