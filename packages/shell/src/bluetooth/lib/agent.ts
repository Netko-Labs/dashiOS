/**
 * The pairing agent: `org.bluez.Agent1`, exported on the shell's own system
 * bus connection and registered with BlueZ as the default agent. When a
 * pairing needs a person (compare these codes, type this PIN, read this
 * passkey), bluetoothd calls the agent, and the agent hands the question to
 * the `PairingHandler` (the store, which puts a sheet on screen).
 *
 * The capability is `KeyboardDisplay`, the most BlueZ offers: it can show a
 * code, take one, and ask yes or no, so it gets the most secure pairing each
 * device supports (headphones need nothing, phones compare six digits,
 * keyboards show a passkey to type on them).
 *
 * Only bluetoothd may call it. Any process on the system bus could try, and
 * "pair with this device" must not be answerable (or askable) by anything
 * but the daemon that is pairing.
 */

import { BUS_NAME, type CallContext, DBusError, ERRORS, getNameOwner, type InterfaceSpec, type MethodSpec } from "../../shared/dbus/index.ts";
import { classify } from "../failures.ts";
import type { Answer, AskRequest, PairingHandler } from "../types.ts";
import { AGENT_MANAGER, BLUEZ, BLUEZ_ROOT, type BluezClient } from "./bluez-client.ts";
import { cleanName, DEVICE_PATH, IFACE, isPin } from "./values.ts";

export const AGENT_PATH = "/org/dashi/bluetooth/Agent";
export const AGENT_INTERFACE = "org.bluez.Agent1";
export const CAPABILITY = "KeyboardDisplay";

/** BlueZ gives up on an unanswered question after about a minute and calls `Cancel`; this is the backstop. */
const ASK_TIMEOUT_MS = 90_000;
const NAME_TIMEOUT_MS = 5000;

const rejected = (text: string) => new DBusError("org.bluez.Error.Rejected", text);
const canceled = () => new DBusError("org.bluez.Error.Canceled", "canceled");
const denied = () => new DBusError("org.freedesktop.DBus.Error.AccessDenied", "only bluetoothd may call the agent");

/** What the agent needs from its surroundings; the real ones ask BlueZ, tests supply their own. */
export interface AgentEnv {
  /** Whether `sender` is bluetoothd. */
  fromBluez(sender: string | undefined): boolean;
  /** The name to show for the device at `path` (cleaned). */
  nameOf(path: string): Promise<string>;
  /** Whether the device at `path` is paired right now. */
  isPaired(path: string): Promise<boolean>;
  handler(): PairingHandler | null;
  askTimeoutMs?: number;
}

/** `ay`/`u` codes as the six digits a person compares and types. */
const passkeyText = (passkey: number): string => String(passkey).padStart(6, "0");

const validPasskey = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 999_999;

/** The checks every call passes: from bluetoothd, about a device path BlueZ could have made. */
function checkDevice(env: AgentEnv, call: CallContext, path: unknown): string {
  if (!env.fromBluez(call.sender)) throw denied();
  if (typeof path !== "string" || !DEVICE_PATH.test(path)) throw new DBusError(ERRORS.invalidArgs, "not a device");
  return path;
}

/** Asks the person; an unanswered question is withdrawn after a while. */
async function askPerson(env: AgentEnv, build: (name: string) => AskRequest, path: string): Promise<Extract<Answer, { ok: true }>> {
  const handler = env.handler();
  if (!handler) throw rejected("no one to ask");
  const request = build(await env.nameOf(path));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Answer>((resolve) => {
    timer = setTimeout(() => {
      handler.dismiss();
      resolve({ ok: false, reason: "cancelled" });
    }, env.askTimeoutMs ?? ASK_TIMEOUT_MS);
  });
  const answer = await Promise.race([handler.ask(request), timeout]).finally(() => clearTimeout(timer));
  if (!answer.ok) throw answer.reason === "cancelled" ? canceled() : rejected("the person said no");
  return answer;
}

/** Takes the question down; only bluetoothd may. */
function dismissMethod(env: AgentEnv): MethodSpec {
  return {
    handler: (_args, call) => {
      if (!env.fromBluez(call.sender)) throw denied();
      env.handler()?.dismiss();
    },
  };
}

export function agentInterface(env: AgentEnv): InterfaceSpec {
  const check = (call: CallContext, path: unknown): string => checkDevice(env, call, path);
  const ask = (build: (name: string) => AskRequest, path: string): Promise<Extract<Answer, { ok: true }>> => askPerson(env, build, path);

  const method = (spec: MethodSpec): MethodSpec => spec;
  const dismiss = dismissMethod(env);

  return {
    name: AGENT_INTERFACE,
    methods: {
      // bluetoothd drops the agent (it is shutting down, or we unregistered): nothing is pending any more.
      Release: dismiss,
      RequestPinCode: method({
        in: "o",
        out: "s",
        handler: async ([device], call) => {
          const path = check(call, device);
          const { value } = await ask((name) => ({ kind: "enter-pin", path, name }), path);
          if (value === null || !isPin(value)) throw rejected("not a PIN");
          return value;
        },
      }),
      DisplayPinCode: method({
        in: "os",
        handler: async ([device, pin], call) => {
          const path = check(call, device);
          if (typeof pin !== "string" || !isPin(pin)) throw new DBusError(ERRORS.invalidArgs, "not a PIN");
          env.handler()?.show({ kind: "show-pin", path, name: await env.nameOf(path), pin });
        },
      }),
      RequestPasskey: method({
        in: "o",
        out: "u",
        handler: async ([device], call) => {
          const path = check(call, device);
          const { value } = await ask((name) => ({ kind: "enter-passkey", path, name }), path);
          if (value === null || !/^\d{1,6}$/.test(value)) throw rejected("not a passkey");
          return Number(value);
        },
      }),
      DisplayPasskey: method({
        in: "ouq",
        handler: async ([device, passkey, entered], call) => {
          const path = check(call, device);
          if (!validPasskey(passkey) || typeof entered !== "number") throw new DBusError(ERRORS.invalidArgs, "not a passkey");
          env.handler()?.show({ kind: "show-passkey", path, name: await env.nameOf(path), passkey: passkeyText(passkey), entered: Math.min(entered, 6) });
        },
      }),
      RequestConfirmation: method({
        in: "ou",
        handler: async ([device, passkey], call) => {
          const path = check(call, device);
          if (!validPasskey(passkey)) throw new DBusError(ERRORS.invalidArgs, "not a passkey");
          await ask((name) => ({ kind: "confirm", path, name, passkey: passkeyText(passkey) }), path);
        },
      }),
      // A device asks to pair with this computer and needs no code: still the person's decision.
      RequestAuthorization: method({
        in: "o",
        handler: async ([device], call) => {
          const path = check(call, device);
          await ask((name) => ({ kind: "authorize", path, name }), path);
        },
      }),
      // A device that is paired may use its services; one that is not may not.
      AuthorizeService: method({
        in: "os",
        handler: async ([device, uuid], call) => {
          const path = check(call, device);
          if (typeof uuid !== "string" || !/^[0-9a-fA-F-]{36}$/.test(uuid)) throw new DBusError(ERRORS.invalidArgs, "not a UUID");
          if (!(await env.isPaired(path))) throw rejected("not paired");
        },
      }),
      Cancel: dismiss,
    },
  };
}

/** The address a device path stands for, for a device that has no name to show. */
export const addressOf = (path: string): string => path.slice(path.lastIndexOf("dev_") + 4).replaceAll("_", ":");

/**
 * Exports the agent on a connection and keeps it registered: when bluetoothd
 * (re)starts it forgets its agents, so the registration is made again.
 */
export class AgentRegistration {
  private owner: string | null = null;
  private stopWatching: (() => Promise<void>) | null = null;

  constructor(
    private readonly client: BluezClient,
    private readonly handler: () => PairingHandler | null,
    private readonly options: { askTimeoutMs?: number } = {},
  ) {}

  private env(): AgentEnv {
    return {
      fromBluez: (sender) => sender !== undefined && sender === this.owner,
      nameOf: async (path) => {
        for (const property of ["Alias", "Name"]) {
          const value = await this.client.property(path, IFACE.device, property, NAME_TIMEOUT_MS).catch(() => null);
          if (typeof value === "string" && cleanName(value) !== "") return cleanName(value);
        }
        return addressOf(path);
      },
      isPaired: async (path) => (await this.client.property(path, IFACE.device, "Paired", NAME_TIMEOUT_MS).catch(() => false)) === true,
      handler: this.handler,
      ...(this.options.askTimeoutMs === undefined ? {} : { askTimeoutMs: this.options.askTimeoutMs }),
    };
  }

  /** Exports the agent and registers it now and whenever bluetoothd comes back. Rejects if it cannot be registered yet. */
  async start(): Promise<void> {
    const { connection } = this.client;
    connection.export(AGENT_PATH, [agentInterface(this.env())]);
    this.stopWatching = await connection.subscribe(
      { type: "signal", sender: BUS_NAME, interface: BUS_NAME, member: "NameOwnerChanged", path: "/org/freedesktop/DBus", args: { 0: BLUEZ } },
      (changed) => {
        const owner = changed.body[2];
        this.owner = typeof owner === "string" && owner !== "" ? owner : null;
        if (this.owner) void this.register().catch((error) => console.error("dashi-shell: Bluetooth: pairing agent:", classify(error)));
      },
    );
    await this.register();
  }

  private async register(): Promise<void> {
    this.owner ??= await getNameOwner(this.client.connection, BLUEZ).catch(() => null);
    try {
      await this.client.call(BLUEZ_ROOT, AGENT_MANAGER, "RegisterAgent", "os", [AGENT_PATH, CAPABILITY]);
    } catch (error) {
      if (classify(error) !== "already") throw error;
    }
    // Pairings the other side starts come to the default agent. Ours can still pair without it.
    await this.client.call(BLUEZ_ROOT, AGENT_MANAGER, "RequestDefaultAgent", "o", [AGENT_PATH]).catch((error) => {
      console.error("dashi-shell: Bluetooth: not the default agent:", error instanceof DBusError ? error.errorName : "error");
    });
  }

  stop(): void {
    void this.stopWatching?.().catch(() => {});
    this.stopWatching = null;
  }
}
