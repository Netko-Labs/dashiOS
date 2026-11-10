/**
 * Joining a network through NetworkManager: make or update the profile,
 * activate it, and wait for the activation to end. The password goes to
 * NetworkManager inside the D-Bus message and nowhere else: not argv, not a
 * file, not a log line.
 */

import { DBusError } from "../shared/dbus/index.ts";
import { canJoinNew, needsPassword, ssidFromKey } from "./networks.ts";
import { IFACE, NM, NM_PATH, type NmClient } from "./nm-client.ts";
import { newProfile, withPassword } from "./nm-values.ts";
import type { JoinResult, WifiNetwork } from "./types.ts";

/** NMDeviceState values the join watches the device for. */
const DEVICE_NEED_AUTH = 60;
const DEVICE_FAILED = 120;
/** NMDeviceStateReason: secrets were required and nobody gave them. */
const DEVICE_REASON_NO_SECRETS = 7;

/** NMActiveConnectionState. */
const ACTIVATED = 2;
const DEACTIVATED = 4;
/** NMActiveConnectionStateReason. */
const REASON_CONNECT_TIMEOUT = 6;
const REASON_NO_SECRETS = 9;
const REASON_LOGIN_FAILED = 10;

/**
 * Why an activation ended. NetworkManager says "no secrets" for a wrong
 * passphrase (the handshake fails, it asks for a new one, nobody answers), and
 * the device passes through "need auth" on the way; either one counts.
 */
export function classify(reason: number, authTrouble: boolean): JoinResult {
  if (authTrouble || reason === REASON_NO_SECRETS || reason === REASON_LOGIN_FAILED) return { ok: false, reason: "wrong-password" };
  if (reason === REASON_CONNECT_TIMEOUT) return { ok: false, reason: "timeout" };
  return { ok: false, reason: "failed" };
}

/** Whether a device state change (`StateChanged(new, old, reason)`) says the credentials were refused. */
export function isAuthTrouble(state: unknown, reason: unknown): boolean {
  return state === DEVICE_NEED_AUTH || (state === DEVICE_FAILED && reason === DEVICE_REASON_NO_SECRETS);
}

/** What went wrong, safe to log: the error's name, never its text or the request. */
function describe(error: unknown): string {
  return error instanceof DBusError ? error.errorName : error instanceof Error ? error.name : "unknown error";
}

/** Waits for the active connection at `active` to be up or to end; a connection that never settles is a timeout. */
async function activation(nm: NmClient, active: string, authTrouble: () => boolean, timeoutMs: number): Promise<JoinResult> {
  let settle: (result: JoinResult) => void = () => {};
  const settled = new Promise<JoinResult>((resolve) => (settle = resolve));
  const check = (state: unknown, reason: unknown) => {
    if (state === ACTIVATED) settle({ ok: true });
    else if (state === DEACTIVATED) settle(classify(typeof reason === "number" ? reason : 0, authTrouble()));
  };
  const timer = setTimeout(() => settle({ ok: false, reason: "timeout" }), timeoutMs);
  let stop: (() => Promise<void>) | null = null;
  try {
    // Subscribe first, then ask: a change between the two reaches the handler.
    stop = await nm.connection.subscribe({ type: "signal", sender: NM, path: active, interface: IFACE.active, member: "StateChanged" }, (message) =>
      check(message.body[0], message.body[1]),
    );
    check(await nm.property(active, IFACE.active, "State"), 0);
    return await settled;
  } catch (error) {
    // The connection is gone already (removed, or never started).
    console.error("dashi-shell: Wi-Fi: lost track of the connection:", describe(error));
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
    await stop?.().catch(() => {});
  }
}

/** Starts the connection and returns its active-connection path, and the profile if this call made one. */
async function activate(
  nm: NmClient,
  device: string,
  network: WifiNetwork,
  password: string | null,
): Promise<{ active: string; created: string | null } | null> {
  if (network.profile) {
    if (password !== null) {
      const [reply] = await nm.call(network.profile, IFACE.profile, "GetSettings");
      const updated = withPassword(reply, network.security, password);
      if (!updated) return null;
      await nm.call(network.profile, IFACE.profile, "Update", "a{sa{sv}}", [updated]);
    }
    const [active] = await nm.call(NM_PATH, IFACE.manager, "ActivateConnection", "ooo", [network.profile, device, network.apId]);
    return typeof active === "string" ? { active, created: null } : null;
  }
  const ssid = ssidFromKey(network.key);
  if (!ssid) return null;
  const settings = newProfile(ssid, network.ssid, network.security, password, crypto.randomUUID());
  const [profile, active] = await nm.call(NM_PATH, IFACE.manager, "AddAndActivateConnection", "a{sa{sv}}oo", [settings, device, network.apId]);
  if (typeof active !== "string") return null;
  return { active, created: typeof profile === "string" ? profile : null };
}

export async function joinNetwork(nm: NmClient, device: string, network: WifiNetwork, password: string | null, timeoutMs: number): Promise<JoinResult> {
  if (!network.profile && !canJoinNew(network.security)) return { ok: false, reason: "unsupported" };
  if (!network.profile && needsPassword(network.security) && password === null) return { ok: false, reason: "wrong-password" };

  let authTrouble = false;
  let created: string | null = null;
  let active: string | null = null;
  let stopDevice: (() => Promise<void>) | null = null;
  try {
    // The device path is known up front, so the watch is in place before anything starts.
    stopDevice = await nm.connection.subscribe({ type: "signal", sender: NM, path: device, interface: IFACE.device, member: "StateChanged" }, (message) => {
      if (isAuthTrouble(message.body[0], message.body[2])) authTrouble = true;
    });
    const started = await activate(nm, device, network, password);
    if (!started) return { ok: false, reason: "failed" };
    ({ active, created } = started);
    const result = await activation(nm, active, () => authTrouble, timeoutMs);
    if (!result.ok && result.reason === "timeout") await nm.call(NM_PATH, IFACE.manager, "DeactivateConnection", "o", [active]).catch(() => {});
    if (!result.ok && created) await nm.call(created, IFACE.profile, "Delete").catch(() => {});
    return result;
  } catch (error) {
    console.error("dashi-shell: Wi-Fi: joining failed:", describe(error));
    if (created) await nm.call(created, IFACE.profile, "Delete").catch(() => {});
    return { ok: false, reason: "failed" };
  } finally {
    await stopDevice?.().catch(() => {});
  }
}
