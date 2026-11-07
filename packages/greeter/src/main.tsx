/**
 * dashi-greeter: Dashi's login screen. greetd runs it (through
 * session/dashi-greeter, inside dashi-comp); it shows the login form over the
 * main screen and a backdrop over each other one (screens.ts), logs the
 * person in through greetd, then ends its compositor so greetd can start
 * their session.
 *
 *   GREETD_SOCK=… WAYLAND_DISPLAY=… bun src/main.tsx
 */

import { TextSelectionLook } from "@dashi/ui";
import { type NativeHostTransport, render, spawnNativeHost } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { connectGreetd } from "./greetd/client.ts";
import { Login, type LoginState } from "./greetd/login.ts";
import { recall, remember } from "./memory.ts";
import { metalHost } from "./paths.ts";
import { power } from "./power.ts";
import { mainScreen, type Screen, watchScreens } from "./screens.ts";
import { commandFor, loadSessions } from "./sessions.ts";
import { loadUsers } from "./users.ts";
import { Backdrop, Greeter, type LoginStore } from "./view.tsx";

process.on("unhandledRejection", (reason) => console.error("dashi-greeter: unhandled rejection:", reason));

const users = loadUsers();
const sessions = loadSessions();
const last = recall();
const initialSession = sessions.find((s) => s.id === last.session) ?? sessions[0];
if (!initialSession) {
  console.error("dashi-greeter: no Wayland sessions are installed");
  process.exit(1);
}
const initialUser = users.find((u) => u.name === last.user) ?? (users.length === 1 ? (users[0] ?? null) : null);

const greetd = await connectGreetd();
const listeners = new Set<() => void>();
let chosen = { user: initialUser?.name ?? null, session: initialSession.id };
const login = new Login(greetd, (state: LoginState) => {
  for (const listener of listeners) listener();
  if (state.kind === "started") finish();
});

const store: LoginStore = {
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => login.current,
  begin: (user, session) => {
    chosen = { user: user.name, session: session.id };
    login.begin(user.name, commandFor(session)).catch((error) => console.error("dashi-greeter: login:", error));
  },
  choose: (session) => {
    chosen = { ...chosen, session: session.id };
    login.choose(commandFor(session));
  },
  answer: (text) => void login.answer(text).catch((error) => console.error("dashi-greeter: login:", error)),
};

/** A full-screen surface on `output` (undefined: the compositor's choice), the keyboard's when `keyboard`. */
function surfaceOn(output: string | undefined, keyboard: boolean): NativeHostTransport {
  return spawnNativeHost(metalHost(), {
    title: "Login",
    appId: "dev.dashi.greeter",
    surface: {
      role: "layer",
      layer: "overlay",
      anchor: ["top", "bottom", "left", "right"],
      exclusiveZone: -1,
      keyboard: keyboard ? "exclusive" : "none",
      namespace: keyboard ? "dashi-greeter" : "dashi-greeter-backdrop",
      ...(output === undefined ? {} : { output }),
    },
    // What a screen reader calls it (`MIRIN_METAL_APP_NAME`); a host from before ignores it.
    env: { MIRIN_METAL_APP_NAME: "Dashi" },
  });
}

const greeter = <Greeter users={users} sessions={sessions} initialUser={initialUser} initialSession={initialSession} login={store} onPower={power} />;

/** A surface and the tree on it; closing ends the host. */
interface Shown {
  output: string | undefined;
  close(): void;
}
function show(element: ReactElement, output: string | undefined, keyboard: boolean): Shown {
  const host = surfaceOn(output, keyboard);
  const root = render(<TextSelectionLook>{element}</TextSelectionLook>, host);
  return {
    output,
    close: () => {
      root.unmount();
      host.close();
    },
  };
}

// The login form goes on the main screen; the compositor is asked which that
// is, for a moment, before the form opens wherever the compositor puts it.
let form: Shown | null = null;
const backdrops = new Map<string, Shown>();

function arrange(screens: Screen[]): void {
  const main = mainScreen(screens);
  if (form === null || (main !== undefined && main !== form.output)) {
    form?.close();
    form = show(greeter, main, true);
  }
  const others = new Set(screens.map((screen) => screen.name).filter((name) => name !== main));
  for (const [name, backdrop] of backdrops) {
    if (others.has(name)) continue;
    backdrop.close();
    backdrops.delete(name);
  }
  for (const name of others) {
    if (!backdrops.has(name)) backdrops.set(name, show(<Backdrop />, name, false));
  }
}
const stopScreens = await watchScreens(arrange).catch((error) => {
  console.error("dashi-greeter: no screens from the compositor:", error);
  return () => {};
});
setTimeout(() => {
  if (form === null) form = show(greeter, undefined, true);
}, 1500);

/** In: remember who, close up, and end the compositor so greetd starts the session. */
function finish(): void {
  remember(chosen);
  greetd.close();
  stopScreens();
  setTimeout(() => {
    form?.close();
    for (const backdrop of backdrops.values()) backdrop.close();
    const compositor = Number(process.env.DASHI_GREETER_COMPOSITOR);
    if (Number.isInteger(compositor) && compositor > 1) process.kill(compositor, "SIGTERM");
    process.exit(0);
  }, 400);
}
