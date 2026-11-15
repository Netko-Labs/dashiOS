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

import { Atspi, type Focused, fieldAt, focusedField, limits, ROLE } from "../../agents/index.ts";
import { DBusConnection, unwrap } from "../../shared/dbus/index.ts";

/** How long "accessibility is off" is believed before asking again. */
const STATUS_MS = 30_000;

/** The field with the keyboard, as dictation reads it: what it is, the page it is in, and the text around its caret. */
export interface FieldText {
  kind: "password" | "text" | "other";
  role: "terminal" | "entry" | "text" | "other";
  /** The host of the web page it is in, or null outside one. */
  site: string | null;
  /** Null where the field's text can't be read (and always in a password field: it is never asked). */
  before: string | null;
  after: string | null;
}

export interface FieldCheck {
  /** Whether the app running as `pid` has a password field focused; false when it can't be told. */
  passwordFocused(pid: number): Promise<boolean>;
}

export interface FieldReader {
  /** The focused field of the app running as `pid`, with up to `span` characters each side of its caret; null when it can't be told. */
  read(pid: number, span?: number): Promise<FieldText | null>;
}

function siteOf(documents: readonly string[]): string | null {
  for (const address of documents) {
    try {
      const host = new URL(address).hostname;
      if (host) return host;
    } catch {}
  }
  return null;
}

const roleOf = (field: Focused): FieldText["role"] =>
  field.role === ROLE.TERMINAL ? "terminal" : field.role === ROLE.ENTRY ? "entry" : field.kind === "text" ? "text" : "other";

async function fieldText(field: Focused, span: number): Promise<FieldText> {
  const base = { kind: field.kind, role: roleOf(field), site: siteOf(field.documents) };
  if (field.kind === "password") return { ...base, before: null, after: null };
  const text = (await field.text?.(span)) ?? null;
  return { ...base, before: text?.before ?? null, after: text?.after ?? null };
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
export function atspiFieldCheck(options: { turnOn?: boolean } = {}): FieldCheck & FieldReader {
  let on: { value: boolean; at: number } | null = null;
  let atspi: Atspi | null = null;
  /** The focused field of the app running as `pid`; null when it can't be told. */
  const focused = async (pid: number): Promise<Focused | null> => {
    if (!options.turnOn && !atspi) {
      if (!on || Date.now() - on.at > STATUS_MS) on = { value: await accessibilityOn(), at: Date.now() };
      if (!on.value) return null;
    }
    atspi ??= await Atspi.connect();
    if (!atspi) return null;
    try {
      const node = await atspi.focusedIn(pid);
      const field = node ? await fieldAt(node) : null;
      if (field) return field;
      const app = await atspi.appFor(pid);
      return app ? await focusedField(app, limits(300, 2000)) : null;
    } catch {
      return null;
    }
  };
  return {
    passwordFocused: async (pid) => (await focused(pid))?.kind === "password",
    async read(pid, span = 400) {
      const field = await focused(pid);
      return field ? fieldText(field, span).catch(() => null) : null;
    },
  };
}
