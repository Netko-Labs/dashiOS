/**
 * xdg-desktop-portal's permission store on the session bus
 * (org.freedesktop.impl.portal.PermissionStore, run by
 * xdg-permission-store): read every grant of the tables portal-grants.ts
 * knows, take one back, and hear when any changes.
 *
 *   Lookup(s table, s id) → (a{sas} permissions, v data)
 *   List(s table) → (as ids)
 *   DeletePermission(s table, s id, s app)          (version 2)
 *   SetPermission(s table, b create, s id, s app, as permissions)
 *   signal Changed(s table, s id, b deleted, v data, a{sas} permissions)
 *
 * A table the store has never written is an error to look up: it holds
 * nothing, and the rest are still read.
 */

import type { CallSpec, MatchRule, Message } from "../../shared/dbus/index.ts";
import { grantsOf, MAX_ENTRIES, PORTAL_TABLES, type PortalGrant, parsePermissions } from "../portal-grants.ts";

export const PERMISSION_STORE = {
  destination: "org.freedesktop.impl.portal.PermissionStore",
  path: "/org/freedesktop/impl/portal/PermissionStore",
  interface: "org.freedesktop.impl.portal.PermissionStore",
} as const;

/** What the store needs of a bus connection. */
export interface PermissionBus {
  call(spec: CallSpec): Promise<unknown[]>;
  subscribe(rule: MatchRule, handler: (message: Message) => void): Promise<() => Promise<void>>;
}

export class PermissionStore {
  constructor(private readonly bus: () => Promise<PermissionBus>) {}

  private async call(member: string, signature: string, body: readonly unknown[]): Promise<unknown[]> {
    const bus = await this.bus();
    return bus.call({ ...PERMISSION_STORE, member, signature, body });
  }

  private async lookup(table: string, id: string): Promise<Map<string, string[]>> {
    try {
      const [permissions] = await this.call("Lookup", "ss", [table, id]);
      return parsePermissions(permissions);
    } catch {
      // Nothing written there yet.
      return new Map();
    }
  }

  private async ids(table: string): Promise<string[]> {
    try {
      const [ids] = await this.call("List", "s", [table]);
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id.length <= 512).slice(0, MAX_ENTRIES) : [];
    } catch {
      return [];
    }
  }

  /** Every grant there is now. Throws only when the store can't be reached at all. */
  async list(): Promise<PortalGrant[]> {
    // One call that must answer: the store is there (a table never written answers with an error too, so lookups can't tell).
    const bus = await this.bus();
    await bus.call({ destination: PERMISSION_STORE.destination, path: PERMISSION_STORE.path, interface: "org.freedesktop.DBus.Peer", member: "Ping" });
    const grants: PortalGrant[] = [];
    for (const spec of PORTAL_TABLES) {
      const ids = spec.entries ? Object.keys(spec.entries) : await this.ids(spec.table);
      for (const id of ids) grants.push(...grantsOf(spec, id, await this.lookup(spec.table, id)));
    }
    return grants;
  }

  /** Take one grant back: the app is asked again the next time it wants it. */
  async revoke(grant: Pick<PortalGrant, "table" | "id" | "app">): Promise<void> {
    try {
      await this.call("DeletePermission", "sss", [grant.table, grant.id, grant.app]);
    } catch {
      // A store older than version 2: an empty answer is no answer.
      await this.call("SetPermission", "sbssas", [grant.table, false, grant.id, grant.app, []]);
    }
  }

  /** Hear every change to the store; resolves with what stops it. */
  async watch(onChange: () => void): Promise<() => void> {
    const bus = await this.bus();
    const stop = await bus.subscribe({ type: "signal", interface: PERMISSION_STORE.interface, member: "Changed", path: PERMISSION_STORE.path }, () =>
      onChange(),
    );
    return () => void stop().catch(() => {});
  }
}
