/**
 * What went wrong with an action, from the error BlueZ answered with, in the
 * few ways a person can do something about (and the words for them). The
 * text of an error is for logs; what is shown comes from the name, and the
 * odd message that carries the real reason (`br-connection-page-timeout`).
 */

import { DBusError, ERRORS } from "../dbus/index.ts";
import type { Failure, Reason } from "./types.ts";

const BLUEZ = "org.bluez.Error.";

/** `already` is not a failure: the device is already in the state asked for. `unreachable` means BlueZ itself could not be asked. */
export type Outcome = Reason | "already" | "unreachable";

const UNREACHABLE = new Set<string>([
  ERRORS.disconnected,
  "org.freedesktop.DBus.Error.ServiceUnknown",
  "org.freedesktop.DBus.Error.NameHasNoOwner",
  "org.freedesktop.DBus.Error.NoServer",
]);

export function classify(error: unknown): Outcome {
  if (!(error instanceof DBusError)) return "unreachable";
  const name = error.errorName;
  if (UNREACHABLE.has(name)) return "unreachable";
  if (name === ERRORS.noReply) return "timeout";
  if (!name.startsWith(BLUEZ)) return "failed";
  switch (name.slice(BLUEZ.length)) {
    case "AlreadyExists":
    case "AlreadyConnected":
    case "NotConnected":
    case "DoesNotExist":
      return "already";
    case "Canceled":
    case "AuthenticationCanceled":
      return "cancelled";
    case "AuthenticationRejected":
    case "Rejected":
      return "refused";
    case "AuthenticationFailed":
      return "wrong-code";
    case "AuthenticationTimeout":
      return "timeout";
    case "ConnectionAttemptFailed":
      return "not-responding";
    case "NotReady":
      return "off";
    case "NotSupported":
    case "NotAvailable":
      return "unavailable";
    case "InProgress":
      return "busy";
    default:
      return fromMessage(error.text);
  }
}

/** `org.bluez.Error.Failed` carries the cause in its text. */
function fromMessage(text: string): Failure {
  const lower = text.toLowerCase();
  if (lower.includes("page-timeout") || lower.includes("page timeout") || lower.includes("host is down")) return "not-responding";
  if (lower.includes("profile-unavailable") || lower.includes("profile unavailable")) return "unavailable";
  if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
  return "failed";
}

const MESSAGES: Record<Failure, string> = {
  "not-responding": "The device didn't respond. Make sure it's on and close by.",
  refused: "The device refused.",
  "wrong-code": "The code was wrong, so it wasn't paired.",
  timeout: "That took too long.",
  unavailable: "Dashi can't use this device yet.",
  off: "Bluetooth is turned off.",
  busy: "Bluetooth is busy. Try again in a moment.",
  failed: "Something went wrong.",
};

export const failureMessage = (reason: Failure): string => MESSAGES[reason];

export type Action = "connect" | "disconnect" | "pair" | "forget";

const VERBS: Record<Action, string> = {
  connect: "Couldn't connect.",
  disconnect: "Couldn't disconnect.",
  pair: "Couldn't pair.",
  forget: "Couldn't forget it.",
};

/** The line under the list: what was being done, then why. */
export function failureLine(action: Action, reason: Failure, paired: boolean): string {
  // Pairing worked and connecting did not: say so, the device is in the list now.
  const head = action === "pair" && paired ? "Paired, but couldn't connect." : VERBS[action];
  return `${head} ${failureMessage(reason)}`;
}
