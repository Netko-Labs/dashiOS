/** Notifications as agents see them: cut short and cleaned, newest first. */

import { clean, plainBody } from "../../notifications/text.ts";
import type { HistoryEntry } from "../../notifications/types.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";

/** How much of a body an agent gets; the store keeps up to a thousand characters. */
export const BODY_CHARS = 300;

export function describeNotification(entry: HistoryEntry, now: number) {
  return {
    id: entry.id,
    app: entry.appName,
    summary: clean(entry.summary, 200),
    body: clean(plainBody(entry.body), BODY_CHARS),
    time: new Date(entry.time).toISOString(),
    secondsAgo: Math.max(0, Math.round((now - entry.time) / 1000)),
    urgency: entry.urgency,
    /** Not yet expired or dismissed. */
    open: entry.closed === undefined,
  };
}

export function listNotifications(limit: number, ctx: RunContext): ToolResult {
  // What the notifications say is never put in the menu bar, where a screenshot could carry it.
  ctx.status("Reading your notifications");
  const { history } = ctx.desktop.notifications.getSnapshot();
  const now = Date.now();
  const notifications = history
    .slice(-limit)
    .reverse()
    .map((entry) => describeNotification(entry, now));
  return json({ notifications, total: history.length });
}

export function dismissNotification(id: number, ctx: RunContext): ToolResult {
  ctx.status("Dismissing a notification");
  return ctx.desktop.notifications.remove([id]) === 0
    ? toolError(`There is no notification ${id} in the notification center; list_notifications shows current ids.`)
    : text(`Notification ${id} was dismissed.`);
}

export function clearNotifications(ctx: RunContext): ToolResult {
  ctx.status("Clearing your notifications");
  const count = ctx.desktop.notifications.remove();
  return text(count === 0 ? "There were no notifications to clear." : `Cleared ${count} ${count === 1 ? "notification" : "notifications"}.`);
}
