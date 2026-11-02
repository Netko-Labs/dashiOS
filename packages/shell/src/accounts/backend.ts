/**
 * The real accounts backend: AccountsService (`org.freedesktop.Accounts`) on
 * the system bus, for the user running the shell. Changing one's own name or
 * picture is allowed to the user by polkit; automatic login is an
 * administrator's, so that call allows interactive authorization and the
 * shell's own polkit agent shows the password sheet.
 */

import { DBusConnection, DBusError } from "../dbus/index.ts";
import { propertyMap } from "../dbus/properties.ts";
import { cleanText } from "../system/text.ts";
import { iconProblem, nameProblem, parseAccount } from "./parse.ts";
import type { Account, AccountsBackend, ChangeResult } from "./types.ts";

const ACCOUNTS = "org.freedesktop.Accounts";
const ACCOUNTS_PATH = "/org/freedesktop/Accounts";
const USER = "org.freedesktop.Accounts.User";
const PROPERTIES = "org.freedesktop.DBus.Properties";
/** A user's object path. */
const USER_PATH = /^\/org\/freedesktop\/Accounts\/User\d{1,10}$/;

export interface AccountsOptions {
  /** How the system bus is reached (tests point it at a private bus). */
  connect?: () => Promise<DBusConnection>;
  uid?: number;
  /** A picture's size in bytes; null when it cannot be read. */
  sizeOf?: (path: string) => number | null;
}

const fileSize = (path: string): number | null => {
  try {
    return Bun.file(path).size;
  } catch {
    return null;
  }
};

/** What went wrong in words for the pane; the service's text is used only when it is short and plain. */
export function describeFailure(error: unknown): string {
  if (error instanceof DBusError) {
    if (/NotAuthorized|AccessDenied/.test(error.name)) return "Not allowed: the password was not given, or this account can't change that.";
    if (error.message) return cleanText(error.message).slice(0, 160);
  }
  return "Accounts can't be reached.";
}

export class AccountsServiceBackend implements AccountsBackend {
  private connection: Promise<DBusConnection> | null = null;
  private readonly connect: () => Promise<DBusConnection>;
  private readonly uid: number;

  constructor(private readonly options: AccountsOptions = {}) {
    this.connect = options.connect ?? (() => DBusConnection.connect({ bus: "system" }));
    this.uid = options.uid ?? process.getuid?.() ?? 0;
  }

  private bus(): Promise<DBusConnection> {
    this.connection ??= this.connect().then(
      (connection) => {
        connection.onClose(() => {
          this.connection = null;
        });
        return connection;
      },
      (error) => {
        this.connection = null;
        throw error;
      },
    );
    return this.connection;
  }

  private async userPath(bus: DBusConnection): Promise<string> {
    const [path] = await bus.call({
      destination: ACCOUNTS,
      path: ACCOUNTS_PATH,
      interface: ACCOUNTS,
      member: "FindUserById",
      signature: "x",
      body: [BigInt(this.uid)],
    });
    if (typeof path !== "string" || !USER_PATH.test(path)) throw new TypeError("AccountsService answered with something that is not a user");
    return path;
  }

  async read(): Promise<Account | null> {
    try {
      const bus = await this.bus();
      const path = await this.userPath(bus);
      const [reply] = await bus.call({ destination: ACCOUNTS, path, interface: PROPERTIES, member: "GetAll", signature: "s", body: [USER] });
      const properties = propertyMap(reply);
      return properties ? parseAccount(properties) : null;
    } catch {
      return null;
    }
  }

  private async set(member: string, signature: string, body: unknown[], interactive = false): Promise<ChangeResult> {
    try {
      const bus = await this.bus();
      const path = await this.userPath(bus);
      // Authentication waits for the person: well past the default call timeout.
      await bus.call({ destination: ACCOUNTS, path, interface: USER, member, signature, body, interactive }, 120_000);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: describeFailure(error) };
    }
  }

  async setRealName(name: string): Promise<ChangeResult> {
    const problem = nameProblem(name);
    return problem === null ? this.set("SetRealName", "s", [name.trim()]) : { ok: false, message: problem };
  }

  async setIcon(path: string): Promise<ChangeResult> {
    const problem = iconProblem(path, (this.options.sizeOf ?? fileSize)(path));
    return problem === null ? this.set("SetIconFile", "s", [path]) : { ok: false, message: problem };
  }

  setAutomaticLogin(on: boolean): Promise<ChangeResult> {
    return this.set("SetAutomaticLogin", "b", [on], true);
  }

  close(): void {
    const connection = this.connection;
    this.connection = null;
    void connection?.then((bus) => bus.close()).catch(() => {});
  }
}
