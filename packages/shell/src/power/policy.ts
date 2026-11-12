/**
 * What the system does with the lid and the power button, read from logind
 * (`HandleLidSwitch` and its variants are the system's own configuration,
 * /etc/systemd/logind.conf: a per-session setting would have to override it
 * with an inhibitor, which Dashi only uses for its own reasons). Settings
 * shows them as they are. Read-only; a machine without logind shows nothing.
 */

import { readdirSync, readFileSync } from "node:fs";
import { DBusConnection, propertyMap } from "../shared/dbus/index.ts";
import { LOGIND, MANAGER, MANAGER_PATH } from "../shared/logind/index.ts";

export const POWER_ACTIONS = [
  "ignore",
  "poweroff",
  "reboot",
  "halt",
  "kexec",
  "suspend",
  "hibernate",
  "hybrid-sleep",
  "suspend-then-hibernate",
  "lock",
] as const;
export type PowerAction = (typeof POWER_ACTIONS)[number];

export interface LidPolicy {
  /** Closing the lid on battery, with nothing else attached. */
  lid: PowerAction;
  /** Closing it while on a charger. */
  lidExternalPower: PowerAction;
  /** Closing it with an external monitor (or more) attached. */
  lidDocked: PowerAction;
}

const isAction = (value: unknown): value is PowerAction => POWER_ACTIONS.some((action) => action === value);

/** The three lid properties of the logind Manager (a{sv}); null when one is missing or odd. */
export function parseLidPolicy(properties: ReadonlyMap<string, unknown>): LidPolicy | null {
  const lid = properties.get("HandleLidSwitch");
  const lidExternalPower = properties.get("HandleLidSwitchExternalPower");
  const lidDocked = properties.get("HandleLidSwitchDocked");
  return isAction(lid) && isAction(lidExternalPower) && isAction(lidDocked) ? { lid, lidExternalPower, lidDocked } : null;
}

const SENTENCE: Record<PowerAction, string> = {
  ignore: "Nothing happens",
  poweroff: "Shuts down",
  reboot: "Restarts",
  halt: "Halts",
  kexec: "Restarts the kernel",
  suspend: "Sleeps",
  hibernate: "Hibernates",
  "hybrid-sleep": "Sleeps and hibernates",
  "suspend-then-hibernate": "Sleeps, then hibernates",
  lock: "Locks the screen",
};

export const describeAction = (action: PowerAction): string => SENTENCE[action];

export interface LidSource {
  /** Null when logind cannot be asked. */
  read(): Promise<LidPolicy | null>;
}

/** Whether the kernel has an input device for a lid switch (a desktop has none, and a lid policy means nothing there). */
export function hasLidSwitch(root = "/sys/class/input"): boolean {
  try {
    return readdirSync(root).some((entry) => {
      try {
        return /lid switch/i.test(readFileSync(`${root}/${entry}/name`, "utf8"));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function logindLid(
  connect: () => Promise<DBusConnection> = () => DBusConnection.connect({ bus: "system" }),
  lidPresent: () => boolean = () => hasLidSwitch(),
): LidSource {
  return {
    read: async () => {
      if (!lidPresent()) return null;
      let connection: DBusConnection | undefined;
      try {
        connection = await connect();
        const [reply] = await connection.call({
          destination: LOGIND,
          path: MANAGER_PATH,
          interface: "org.freedesktop.DBus.Properties",
          member: "GetAll",
          signature: "s",
          body: [MANAGER],
        });
        const properties = propertyMap(reply);
        return properties ? parseLidPolicy(properties) : null;
      } catch {
        return null;
      } finally {
        connection?.close();
      }
    },
  };
}

/** logind's defaults (suspend; ignored when docked), for a development run, which does not ask the host. */
export const fakeLid = (): LidSource => ({ read: async () => ({ lid: "suspend", lidExternalPower: "suspend", lidDocked: "ignore" }) });
