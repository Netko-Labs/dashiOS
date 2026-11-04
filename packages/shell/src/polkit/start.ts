/**
 * Starting the authentication agent: which bus it may touch, the sheet, and
 * the registration. A development run never reaches the machine's system
 * bus (registering there would replace the developer's own agent, and a
 * password typed into a nested session would reach their polkitd); it may
 * use a private bus named by `DBUS_SYSTEM_BUS_ADDRESS`, which is how the
 * agent is exercised without a real session.
 */

import { realpathSync } from "node:fs";
import { iconPath } from "../apps.ts";
import { SYSTEM_BUS_PATH, socketPaths } from "../dbus/address.ts";
import { DBusConnection } from "../dbus/index.ts";
import { resolveIcon } from "../entries.ts";
import type { OpenOverlay } from "../overlay.tsx";
import { type LockSignal, PolkitController } from "./controller.ts";
import { findHelper } from "./helper.ts";
import { PolkitPrompt } from "./prompt.tsx";
import { serveAgent } from "./service.ts";
import { agentLocale, sessionSubject } from "./subject.ts";

export interface PolkitOptions {
  /** A development run (`system/stand-in.ts`): never the machine's own system bus. */
  developmentRun: boolean;
  lock: LockSignal;
  open: OpenOverlay;
  env?: Record<string, string | undefined>;
}

export interface Polkit {
  close(): void;
}

const OFF: Polkit = { close() {} };
/** The other spelling of the system bus's socket (`/var/run` is `/run`). */
const SYSTEM_BUS_ALIASES = [SYSTEM_BUS_PATH, "/var/run/dbus/system_bus_socket"];

const resolved = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** Whether `address` leads to the machine's own system bus. */
export function isMachineBus(address: string): boolean {
  const own = new Set(SYSTEM_BUS_ALIASES.map(resolved));
  return socketPaths(address).some((path) => own.has(resolved(path)));
}

/**
 * The bus address the agent may register on, or null (with the reason): a
 * real session uses the system bus; a development run only an address it was
 * explicitly given that is not the machine's.
 */
export function agentBus(env: Record<string, string | undefined>, developmentRun: boolean): { address?: string; off?: string } {
  const given = env.DBUS_SYSTEM_BUS_ADDRESS;
  if (!developmentRun) return given ? { address: given } : {};
  if (!given || given.startsWith("disabled:")) return { off: "this is a development run" };
  if (isMachineBus(given)) return { off: "this is a development run and DBUS_SYSTEM_BUS_ADDRESS is the machine's own bus" };
  return { address: given };
}

export function startPolkit(options: PolkitOptions): Polkit {
  const env = options.env ?? process.env;
  const bus = agentBus(env, options.developmentRun);
  if (bus.off) {
    console.error(`dashi-shell: polkit agent is off (${bus.off})`);
    return OFF;
  }
  // The helper may be swapped for a stand-in only on a development run.
  const helper = (options.developmentRun ? env.DASHI_POLKIT_HELPER : undefined) ?? findHelper();
  if (!helper) {
    console.error("dashi-shell: polkit agent is off (no polkit-agent-helper-1 installed)");
    return OFF;
  }
  const subject = sessionSubject(env);
  if (!subject) {
    console.error("dashi-shell: polkit agent is off (no login session id and no process start time to register with)");
    return OFF;
  }
  const generic = iconPath("generic");
  const controller = new PolkitController({
    presenter: new PolkitPrompt(options.open),
    lock: options.lock,
    helper,
    icon: (name) => {
      if (!name) return null;
      const path = resolveIcon(name);
      return path === generic ? null : path;
    },
  });
  const service = serveAgent({
    controller,
    connect: () => DBusConnection.connect(bus.address ? { address: bus.address } : { bus: "system" }),
    subject,
    locale: agentLocale(env),
  });
  return {
    close() {
      service.close();
      controller.close();
    },
  };
}
