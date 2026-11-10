/**
 * The agent on the system bus: `org.freedesktop.PolicyKit1.AuthenticationAgent`
 * exported at our own path, registered with polkitd for our session. polkitd
 * calls `BeginAuthentication` when something needs a password and
 * `CancelAuthentication` when it no longer does.
 *
 * Only polkitd is believed: calls from any other connection are refused (the
 * system bus's policy already keeps ordinary users from sending to us; this
 * does not depend on it). If the bus or polkitd goes away, requests in flight
 * are cancelled, and the registration is made again as soon as both are back
 * (polkitd forgets its agents when it restarts).
 */

import { BUS_PATH } from "../shared/dbus/bus.ts";
import { BUS_NAME, type DBusConnection, DBusError, ERRORS, getNameOwner, type InterfaceSpec } from "../shared/dbus/index.ts";
import type { PolkitController } from "./controller.ts";
import { parseBegin } from "./request.ts";
import type { Subject } from "./subject.ts";

export const AUTHORITY_NAME = "org.freedesktop.PolicyKit1";
export const AUTHORITY_PATH = "/org/freedesktop/PolicyKit1/Authority";
export const AUTHORITY_INTERFACE = "org.freedesktop.PolicyKit1.Authority";
export const AGENT_INTERFACE = "org.freedesktop.PolicyKit1.AuthenticationAgent";
/** Ours alone: the agent of another desktop would not clash with it. */
export const AGENT_PATH = "/dev/dashi/PolicyKit1/AuthenticationAgent";

/** `BeginAuthentication(action_id, message, icon_name, details, cookie, identities)` and `CancelAuthentication(cookie)`. */
export function agentInterface(controller: PolkitController, fromAuthority: (sender: string | undefined) => boolean): InterfaceSpec {
  const guard = (sender: string | undefined): void => {
    if (!fromAuthority(sender)) throw new DBusError(ERRORS.accessDenied, "only polkitd may call this agent");
  };
  return {
    name: AGENT_INTERFACE,
    methods: {
      BeginAuthentication: {
        in: "sssa{ss}sa(sa{sv})",
        handler: (args, call) => {
          guard(call.sender);
          return controller.begin(parseBegin(args));
        },
      },
      CancelAuthentication: {
        in: "s",
        handler: ([cookie], call) => {
          guard(call.sender);
          if (typeof cookie === "string") controller.cancel(cookie);
        },
      },
    },
  };
}

export interface ServeOptions {
  controller: PolkitController;
  /** Opens the system bus (a private one in tests). */
  connect(): Promise<DBusConnection>;
  subject: Subject;
  locale: string;
  /** Pause before trying again after a failure, doubling up to `retryMaxMs`. */
  retryMs?: number;
  retryMaxMs?: number;
}

export interface AgentService {
  close(): void;
}

const CALL_TIMEOUT_MS = 10_000;

/** A call to polkitd's `Authority` object. */
const authority = (member: string, signature: string, body: unknown[], on: DBusConnection) =>
  on.call({ destination: AUTHORITY_NAME, path: AUTHORITY_PATH, interface: AUTHORITY_INTERFACE, member, signature, body }, CALL_TIMEOUT_MS);

/** Whoever owns the polkit name; starting polkitd (it is bus-activated) if nobody does. */
async function authorityOwner(on: DBusConnection): Promise<string> {
  try {
    return await getNameOwner(on, AUTHORITY_NAME);
  } catch {
    await on.call(
      { destination: BUS_NAME, path: BUS_PATH, interface: BUS_NAME, member: "StartServiceByName", signature: "su", body: [AUTHORITY_NAME, 0] },
      CALL_TIMEOUT_MS,
    );
    return getNameOwner(on, AUTHORITY_NAME);
  }
}

/** Registers the agent at our path with polkitd, for this session. */
async function registerAgent(on: DBusConnection, subject: Subject, locale: string): Promise<void> {
  await authority("RegisterAuthenticationAgent", "(sa{sv})ss", [subject, locale, AGENT_PATH], on);
}

/** Keep the agent registered until `close()`. Never rejects: problems are logged and retried. */
export function serveAgent(options: ServeOptions): AgentService {
  const { controller, subject, locale } = options;
  const retryMin = options.retryMs ?? 1000;
  const retryMax = options.retryMaxMs ?? 30_000;
  let connection: DBusConnection | null = null;
  let owner: string | null = null;
  let closed = false;
  let retry = retryMin;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastComplaint = "";

  const complain = (what: string, error: unknown): void => {
    const text = `${what}: ${error instanceof Error ? error.message : String(error)}`;
    if (text !== lastComplaint) console.error(`dashi-shell: polkit agent: ${text}`);
    lastComplaint = text;
  };

  const register = (on: DBusConnection): Promise<void> => registerAgent(on, subject, locale);

  const attempt = async (): Promise<void> => {
    let on: DBusConnection | null = null;
    try {
      on = await options.connect();
      if (closed) return on.close();
      const bus = on;
      connection = bus;
      bus.onClose((error) => {
        if (connection !== bus) return;
        connection = null;
        owner = null;
        controller.cancelAll("the system bus went away");
        if (!closed) {
          complain("lost the system bus", error ?? "closed");
          schedule();
        }
      });
      bus.export(AGENT_PATH, [agentInterface(controller, (sender) => sender !== undefined && sender === owner)]);
      // polkitd forgets its agents when it restarts, so a new owner of its name means registering again.
      await bus.subscribe(
        { type: "signal", sender: BUS_NAME, interface: BUS_NAME, member: "NameOwnerChanged", path: BUS_PATH, args: { 0: AUTHORITY_NAME } },
        (message) => {
          const next = message.body[2];
          owner = typeof next === "string" && next !== "" ? next : null;
          if (owner === null) return controller.cancelAll("polkitd went away");
          register(bus).catch((error) => complain("could not register again", error));
        },
      );
      owner = await authorityOwner(bus);
      await register(bus);
      retry = retryMin;
      lastComplaint = "";
      console.error("dashi-shell: polkit agent registered");
    } catch (error) {
      complain("could not register", error);
      if (connection === on) connection = null;
      on?.close();
      schedule();
    }
  };

  const schedule = (): void => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void attempt();
    }, retry);
    retry = Math.min(retry * 2, retryMax);
  };

  void attempt();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      const on = connection;
      connection = null;
      // Best effort: polkitd drops the registration by itself when the connection closes.
      on?.call({
        destination: AUTHORITY_NAME,
        path: AUTHORITY_PATH,
        interface: AUTHORITY_INTERFACE,
        member: "UnregisterAuthenticationAgent",
        signature: "(sa{sv})s",
        body: [subject, AGENT_PATH],
        noReply: true,
      }).catch(() => {});
      on?.close();
    },
  };
}
