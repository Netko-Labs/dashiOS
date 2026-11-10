/** The shapes callers hand to a connection and get back from it. */

export interface CallSpec {
  destination?: string;
  path: string;
  interface?: string;
  member: string;
  signature?: string;
  body?: readonly unknown[];
  /** Don't wait for (or ask for) a reply; the promise resolves with no values. */
  noReply?: boolean;
  /** Lets the service ask polkit to authenticate the person (its agent shows the sheet) instead of refusing outright. */
  interactive?: boolean;
}

export interface SignalSpec {
  path: string;
  interface: string;
  member: string;
  signature?: string;
  body?: readonly unknown[];
  /** Send to one connection instead of everyone whose rules match. */
  destination?: string;
}

export interface ExportedObject {
  readonly path: string;
  /** Emit one of the object's declared signals. */
  emit(interfaceName: string, signal: string, ...args: unknown[]): void;
  /** Announce that these properties of an interface changed (their current values are sent). */
  propertiesChanged(interfaceName: string, names: readonly string[]): void;
  unexport(): void;
}
