/**
 * The two ways D-Bus work fails. A `DBusError` is an answer: the other side
 * replied with an error (or we couldn't wait for a reply), and callers can
 * match on its `errorName`. A `ProtocolError` means the bytes themselves
 * were wrong, which is never recoverable on that connection.
 */

/** Well-known error names this implementation raises or replies with. */
export const ERRORS = {
  failed: "org.freedesktop.DBus.Error.Failed",
  noReply: "org.freedesktop.DBus.Error.NoReply",
  disconnected: "org.freedesktop.DBus.Error.Disconnected",
  unknownMethod: "org.freedesktop.DBus.Error.UnknownMethod",
  unknownObject: "org.freedesktop.DBus.Error.UnknownObject",
  unknownInterface: "org.freedesktop.DBus.Error.UnknownInterface",
  unknownProperty: "org.freedesktop.DBus.Error.UnknownProperty",
  propertyReadOnly: "org.freedesktop.DBus.Error.PropertyReadOnly",
  invalidArgs: "org.freedesktop.DBus.Error.InvalidArgs",
  limitsExceeded: "org.freedesktop.DBus.Error.LimitsExceeded",
  accessDenied: "org.freedesktop.DBus.Error.AccessDenied",
} as const;

export class DBusError extends Error {
  constructor(
    /** The D-Bus error name, such as `org.freedesktop.DBus.Error.UnknownMethod`. */
    readonly errorName: string,
    /** The human-readable text, without the error name. */
    readonly text = "",
    /** The error message's whole body, for errors that carry more than text. */
    readonly body: readonly unknown[] = [],
  ) {
    super(text ? `${errorName}: ${text}` : errorName);
    this.name = "DBusError";
  }
}

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}
