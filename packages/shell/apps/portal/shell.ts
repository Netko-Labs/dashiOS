/**
 * What dashi-portal asks the shell (src/shared/portal-host/protocol.ts): holds,
 * sheets, the Dock. Over its own session-bus connection, opened on first use
 * and again after a shell restart. When the shell is not there, holds fail
 * (the Inhibit request answers so) and dialogs open as ordinary windows.
 */

import { DBusConnection } from "../../src/shared/dbus/index.ts";
import { PORTAL_HOST, SHELL_NAME, SHELL_PATH } from "../../src/shared/portal-host/index.ts";

export interface ShellLink {
  inhibit(appId: string, reason: string, flags: number): Promise<number>;
  uninhibit(id: number): Promise<void>;
  /** Whether the shell will hang the dialog titled `title` from `parent`. */
  expectSheet(title: string, parent: string): Promise<boolean>;
  addToDock(appId: string, name: string): Promise<void>;
}

export class ShellClient implements ShellLink {
  private connection: Promise<DBusConnection> | null = null;

  constructor(private readonly connect: () => Promise<DBusConnection> = () => DBusConnection.connect({ bus: "session" })) {}

  private bus(): Promise<DBusConnection> {
    if (!this.connection) {
      const opening = this.connect();
      this.connection = opening;
      opening.then(
        (connection) => connection.onClose(() => void (this.connection === opening && (this.connection = null))),
        () => void (this.connection = null),
      );
    }
    return this.connection;
  }

  private async call(member: string, signature: string, body: unknown[]): Promise<unknown[]> {
    const connection = await this.bus();
    return connection.call({ destination: SHELL_NAME, path: SHELL_PATH, interface: PORTAL_HOST, member, signature, body });
  }

  async inhibit(appId: string, reason: string, flags: number): Promise<number> {
    const [id] = await this.call("Inhibit", "ssu", [appId, reason, flags]);
    if (typeof id !== "number") throw new Error("the shell answered Inhibit without an id");
    return id;
  }

  async uninhibit(id: number): Promise<void> {
    await this.call("Uninhibit", "u", [id]);
  }

  async expectSheet(title: string, parent: string): Promise<boolean> {
    try {
      const [ok] = await this.call("ExpectSheet", "ss", [title, parent]);
      return ok === true;
    } catch {
      return false;
    }
  }

  async addToDock(appId: string, name: string): Promise<void> {
    await this.call("AddToDock", "ss", [appId, name]);
  }
}
