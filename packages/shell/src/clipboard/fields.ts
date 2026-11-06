/**
 * Is the focused field a password field? AT-SPI says (role `password text`),
 * the same walk the agents' masks use (agents/atspi/). Clipboard history and
 * snippets ask it before keeping a copy or expanding a keyword.
 *
 * Apps publish their trees only while accessibility is on (for a screen
 * reader, or once an agent connected), and turning it on costs every app.
 * So the history does not turn it on: while it is off the answer is "can't
 * tell", and the other rules (the types' hints, the apps left out) still
 * hold; toolkits refuse to copy out of a password field themselves. Snippets
 * do (`turnOn`), once a keyword is typed: a keyword inside a password must
 * stay as typed.
 */

import { Atspi } from "../agents/atspi/client.ts";
import { fieldAt, focusedField, limits } from "../agents/atspi/tree.ts";
import { DBusConnection } from "../dbus/index.ts";
import { unwrap } from "../dbus/properties.ts";

/** How long "accessibility is off" is believed before asking again. */
const STATUS_MS = 30_000;

export interface FieldCheck {
  /** Whether the app running as `pid` has a password field focused; false when it can't be told. */
  passwordFocused(pid: number): Promise<boolean>;
}

async function accessibilityOn(): Promise<boolean> {
  let session: DBusConnection | null = null;
  try {
    session = await DBusConnection.connect({ bus: "session", timeoutMs: 1000 });
    const [value] = await session.call(
      {
        destination: "org.a11y.Bus",
        path: "/org/a11y/bus",
        interface: "org.freedesktop.DBus.Properties",
        member: "Get",
        signature: "ss",
        body: ["org.a11y.Status", "IsEnabled"],
      },
      500,
    );
    return unwrap(value) === true;
  } catch {
    return false;
  } finally {
    session?.close();
  }
}

/** `turnOn`: join the accessibility bus (turning it on) whatever it was; otherwise only when it is on already. */
export function atspiFieldCheck(options: { turnOn?: boolean } = {}): FieldCheck {
  let on: { value: boolean; at: number } | null = null;
  let atspi: Atspi | null = null;
  return {
    async passwordFocused(pid) {
      if (!options.turnOn && !atspi) {
        if (!on || Date.now() - on.at > STATUS_MS) on = { value: await accessibilityOn(), at: Date.now() };
        if (!on.value) return false;
      }
      atspi ??= await Atspi.connect();
      if (!atspi) return false;
      try {
        const node = await atspi.focusedIn(pid);
        const field = node ? await fieldAt(node) : null;
        if (field) return field.kind === "password";
        const app = await atspi.appFor(pid);
        return app ? (await focusedField(app, limits(300, 2000)))?.kind === "password" : false;
      } catch {
        return false;
      }
    },
  };
}
