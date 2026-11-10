/**
 * The bus's public types: what callers hand to a connection and get back from it, what an
 * exported interface declares (lib/introspect.ts writes its XML), and a signal match rule.
 */

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

export interface MethodSpec {
  /** Argument signature; none when omitted. */
  in?: string;
  /** Result signature; none when omitted. */
  out?: string;
  /**
   * Handles a call. A method with one result type returns that value; with
   * several, an array of them; with none, nothing. Throw a `DBusError` to
   * reply with that error name.
   */
  handler(args: unknown[], call: CallContext): unknown;
}

export interface PropertySpec {
  /** The property's type, one complete type. */
  type: string;
  /** Defaults to `read`. */
  access?: "read" | "write" | "readwrite";
  get?(): unknown;
  set?(value: unknown): void | Promise<void>;
}

export interface InterfaceSpec {
  name: string;
  methods?: Record<string, MethodSpec>;
  /** Signal names to their argument signatures. */
  signals?: Record<string, string>;
  properties?: Record<string, PropertySpec>;
}

export interface CallContext {
  /** The caller's unique name. */
  sender: string | undefined;
  path: string;
  interface: string | undefined;
  member: string;
  /**
   * The descriptors that came with the call (`h` arguments index them), on a
   * connection that carries them (fd-service.ts); open until the handler settles.
   */
  fds?: readonly number[];
}

export interface MatchRule {
  type?: "signal" | "method_call" | "method_return" | "error";
  sender?: string;
  interface?: string;
  member?: string;
  path?: string;
  pathNamespace?: string;
  destination?: string;
  /** Required string arguments by position (`arg0='x'`). */
  args?: Readonly<Record<number, string>>;
}
