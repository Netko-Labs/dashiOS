/** The notification store's data: what an app sent, and what happened to it. */

export type Urgency = "low" | "normal" | "critical";

/** Why a notification went away: the numbers NotificationClosed carries. */
export const CloseReason = {
  expired: 1,
  dismissed: 2,
  closedByApp: 3,
  undefined: 4,
} as const;
export type CloseReason = (typeof CloseReason)[keyof typeof CloseReason];

export interface NotificationAction {
  key: string;
  label: string;
}

/** What `Notify` carries, cleaned (see parse.ts). */
export interface NotifyInput {
  appName: string;
  appIcon: string;
  summary: string;
  body: string;
  actions: NotificationAction[];
  urgency: Urgency;
  /** The `expire_timeout` in ms: -1 asks for the default, 0 for never. */
  expireTimeout: number;
  imagePath: string;
  desktopEntry: string;
  category: string;
  /** Not for the notification center's history. */
  transient: boolean;
  /** Stays after an action is invoked. */
  resident: boolean;
}

export interface Notification extends NotifyInput {
  id: number;
  /** When this version arrived, ms since the epoch. */
  time: number;
  /** How many times an app has replaced it (0 for the first). */
  revision: number;
  /** The bus name the app called from (`:1.42`); empty when unknown. */
  sender: string;
}

/** A notification in the history, with how it ended once it has. */
export interface HistoryEntry extends Notification {
  closed?: { reason: CloseReason; time: number };
}

export type StoreEvent = { type: "closed"; id: number; reason: CloseReason } | { type: "action"; id: number; key: string };

export interface StoreSnapshot {
  /** Not yet closed, oldest first. */
  live: readonly Notification[];
  /** What the banner stack shows, oldest first. */
  banners: readonly Notification[];
  /** What the notification center lists: everything that wasn't transient and hasn't been removed, oldest first, closed or not. */
  history: readonly HistoryEntry[];
  doNotDisturb: boolean;
}
