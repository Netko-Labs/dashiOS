/**
 * dashi-greeter: Dashi's login screen. greetd runs it (through
 * session/dashi-greeter, inside dashi-comp); it shows one layer-shell surface
 * over the whole screen, logs the person in through greetd, then ends its
 * compositor so greetd can start their session.
 *
 *   GREETD_SOCK=… WAYLAND_DISPLAY=… bun src/main.tsx
 */

import { render, spawnNativeHost } from "@mirinjs/metal";
import { connectGreetd } from "./greetd/client.ts";
import { Login, type LoginState } from "./greetd/login.ts";
import { recall, remember } from "./memory.ts";
import { metalHost } from "./paths.ts";
import { power } from "./power.ts";
import { commandFor, loadSessions } from "./sessions.ts";
import { loadUsers } from "./users.ts";
import { Greeter, type LoginStore } from "./view.tsx";

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

const host = spawnNativeHost(metalHost(), {
  title: "Login",
  appId: "dev.dashi.greeter",
  surface: {
    role: "layer",
    layer: "overlay",
    anchor: ["top", "bottom", "left", "right"],
    exclusiveZone: -1,
    keyboard: "exclusive",
    namespace: "dashi-greeter",
  },
});
const root = render(
  <Greeter users={users} sessions={sessions} initialUser={initialUser} initialSession={initialSession} login={store} onPower={power} />,
  host,
);

/** In: remember who, close up, and end the compositor so greetd starts the session. */
function finish(): void {
  remember(chosen);
  greetd.close();
  setTimeout(() => {
    root.unmount();
    const compositor = Number(process.env.DASHI_GREETER_COMPOSITOR);
    if (Number.isInteger(compositor) && compositor > 1) process.kill(compositor, "SIGTERM");
    process.exit(0);
  }, 400);
}
