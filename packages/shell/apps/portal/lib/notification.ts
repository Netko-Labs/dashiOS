/**
 * The portal's Notification (org.freedesktop.impl.portal.Notification,
 * version 2): a sandboxed app's notification goes straight into Dashi's
 * Notification Center, which serves org.freedesktop.Notifications in the
 * shell (src/notifications/). Its buttons and default action come back as
 * ActionInvoked, with the target the app gave. No new UI.
 *
 *   AddNotification(s app_id, s id, a{sv} notification)
 *   RemoveNotification(s app_id, s id)
 *   signal ActionInvoked(s app_id, s id, s action, av parameter)
 */

import { fstatSync, mkdirSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type InterfaceSpec, Variant, variant } from "../../../src/shared/dbus/index.ts";
import { cleanString, str, type Vardict, vardict } from "./vardict.ts";

export const NOTIFICATION = "org.freedesktop.impl.portal.Notification";

export interface Button {
  label: string;
  action: string;
  target: Variant | null;
}

export interface PortalNotification {
  title: string;
  body: string;
  /** An icon theme name, or a picture saved to a file. */
  icon: { name: string } | { bytes: Uint8Array } | null;
  priority: "low" | "normal" | "high" | "urgent";
  defaultAction: string | null;
  defaultTarget: Variant | null;
  buttons: Button[];
  category: string | null;
}

/** What Notify takes, and how its action keys map back to the app's actions. */
export interface NotifyCall {
  summary: string;
  body: string;
  actions: string[];
  hints: Map<string, Variant>;
  /** Notify's action key → the app's action and target. */
  keys: Map<string, { action: string; target: Variant | null }>;
}

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

/** A serialized GIcon (`(sv)`): `themed` names or `bytes`; anything else is no icon. */
export function parseIcon(value: Variant | undefined): PortalNotification["icon"] {
  if (value?.signature !== "(sv)" || !Array.isArray(value.value)) return null;
  const [kind, inner] = value.value as [unknown, unknown];
  if (!(inner instanceof Variant)) return null;
  if (kind === "themed" && inner.signature === "as" && Array.isArray(inner.value)) {
    const name = inner.value.find((each): each is string => typeof each === "string" && /^[\w.+-]{1,128}$/.test(each));
    return name ? { name } : null;
  }
  if (kind === "bytes" && inner.signature === "ay" && inner.value instanceof Uint8Array && inner.value.length < 4 << 20) return { bytes: inner.value };
  return null;
}

function parseButtons(dict: Vardict): Button[] {
  const entry = dict.get("buttons");
  if (entry?.signature !== "aa{sv}" || !Array.isArray(entry.value)) return [];
  return entry.value.slice(0, 3).flatMap((raw): Button[] => {
    const button = vardict(raw);
    const label = str(button, "label");
    const action = str(button, "action");
    return label && action ? [{ label, action, target: button.get("target") ?? null }] : [];
  });
}

export function parseNotification(value: unknown): PortalNotification {
  const dict = vardict(value);
  const priority = str(dict, "priority") ?? "normal";
  return {
    title: str(dict, "title") ?? "",
    body: str(dict, "body") ?? str(dict, "markup-body")?.replace(/<[^>]*>/g, "") ?? "",
    icon: parseIcon(dict.get("icon")),
    priority: PRIORITIES.has(priority) ? (priority as PortalNotification["priority"]) : "normal",
    defaultAction: str(dict, "default-action") ?? null,
    defaultTarget: dict.get("default-action-target") ?? null,
    buttons: parseButtons(dict),
    category: str(dict, "category") ?? null,
  };
}

/**
 * Version 2 sends a picture as `("file-descriptor", <h>)`, a sealed file the
 * call carries; read here (it is closed once the call is answered) into the
 * `bytes` form the rest reads.
 */
export function withFdIcon(value: unknown, fds: readonly number[], read: (fd: number) => Uint8Array | null = readIcon): unknown {
  if (!(value instanceof Map)) return value;
  const icon = value.get("icon");
  if (!(icon instanceof Variant) || icon.signature !== "(sv)" || !Array.isArray(icon.value)) return value;
  const [kind, inner] = icon.value as [unknown, unknown];
  if (kind !== "file-descriptor" || !(inner instanceof Variant) || inner.signature !== "h") return value;
  const fd = typeof inner.value === "number" ? fds[inner.value] : undefined;
  const bytes = fd === undefined ? null : read(fd);
  const next = new Map(value);
  if (bytes) next.set("icon", variant("(sv)", ["bytes", variant("ay", bytes)]));
  else next.delete("icon");
  return next;
}

function readIcon(fd: number): Uint8Array | null {
  try {
    const size = fstatSync(fd).size;
    if (size <= 0 || size > 4 << 20) return null;
    const out = new Uint8Array(size);
    const got = readSync(fd, out, 0, size, 0);
    return out.subarray(0, got);
  } catch {
    return null;
  }
}

/** The Notify call for a portal notification from `appId`. */
export function notifyCall(appId: string, notification: PortalNotification): NotifyCall {
  const keys = new Map<string, { action: string; target: Variant | null }>();
  const actions: string[] = [];
  if (notification.defaultAction) {
    keys.set("default", { action: notification.defaultAction, target: notification.defaultTarget });
    actions.push("default", "");
  }
  notification.buttons.forEach((button, index) => {
    const key = `button-${index}`;
    keys.set(key, { action: button.action, target: button.target });
    actions.push(key, button.label);
  });
  const hints = new Map<string, Variant>([["urgency", variant("y", notification.priority === "low" ? 0 : notification.priority === "normal" ? 1 : 2)]]);
  if (appId) hints.set("desktop-entry", variant("s", appId));
  if (notification.category) hints.set("category", variant("s", notification.category));
  return { summary: notification.title, body: notification.body, actions, hints, keys };
}

export interface NotificationServer {
  /** Notify; resolves with the server's id. */
  notify(appName: string, replaces: number, icon: string, call: NotifyCall): Promise<number>;
  close(id: number): Promise<void>;
}

/** Where pictures sent as bytes are kept for the notification server to read. */
function iconFile(appId: string, id: string, bytes: Uint8Array): string | null {
  try {
    const dir = join(process.env.XDG_RUNTIME_DIR || "/tmp", "dashi-portal", "icons");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${new Bun.CryptoHasher("sha256").update(`${appId}\0${id}`).digest("hex").slice(0, 24)}.png`);
    writeFileSync(path, bytes, { mode: 0o600 });
    return path;
  } catch {
    return null;
  }
}

export class NotificationBackend {
  /** `app_id\0id` → the server's id and the action keys. */
  private readonly shown = new Map<string, { serverId: number; keys: NotifyCall["keys"] }>();

  constructor(
    private readonly server: NotificationServer,
    private readonly invoked: (appId: string, id: string, action: string, parameter: Variant[]) => void,
    private readonly nameOf: (appId: string) => string = (appId) => appId,
  ) {}

  async add(appId: string, id: string, value: unknown): Promise<void> {
    const notification = parseNotification(value);
    const call = notifyCall(appId, notification);
    const key = `${appId}\0${id}`;
    const icon =
      notification.icon === null ? appId : "name" in notification.icon ? notification.icon.name : (iconFile(appId, id, notification.icon.bytes) ?? appId);
    const serverId = await this.server.notify(this.nameOf(appId), this.shown.get(key)?.serverId ?? 0, icon, call);
    this.shown.set(key, { serverId, keys: call.keys });
  }

  async remove(appId: string, id: string): Promise<void> {
    const key = `${appId}\0${id}`;
    const entry = this.shown.get(key);
    if (!entry) return;
    this.shown.delete(key);
    await this.server.close(entry.serverId).catch(() => {});
  }

  /** The server's ActionInvoked. */
  actionInvoked(serverId: number, actionKey: string): void {
    for (const [key, entry] of this.shown) {
      if (entry.serverId !== serverId) continue;
      const action = entry.keys.get(actionKey);
      if (!action) return;
      const [appId = "", id = ""] = key.split("\0");
      this.invoked(appId, id, action.action, action.target ? [action.target] : []);
      return;
    }
  }

  /** The server's NotificationClosed: it is gone from the center. */
  closed(serverId: number): void {
    for (const [key, entry] of this.shown) if (entry.serverId === serverId) this.shown.delete(key);
  }

  spec(): InterfaceSpec {
    const text = (value: unknown) => (typeof value === "string" ? cleanString(value, 256) : "");
    return {
      name: NOTIFICATION,
      methods: {
        AddNotification: {
          in: "ssa{sv}",
          handler: ([appId, id, notification], call) => this.add(text(appId), text(id), withFdIcon(notification, call.fds ?? [])),
        },
        RemoveNotification: { in: "ss", handler: ([appId, id]) => this.remove(text(appId), text(id)) },
      },
      signals: { ActionInvoked: "sssav" },
      properties: {
        SupportedOptions: { type: "a{sv}", get: () => new Map() },
        version: { type: "u", get: () => 2 },
      },
    };
  }
}
