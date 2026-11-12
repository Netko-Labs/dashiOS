/** A record of Work alone in words: its line in Settings, the notification when it ends, and the whole of it as text. Pure. */

import type { NotifyInput } from "../../notifications/index.ts";
import { iconPath } from "../../shared/apps/index.ts";
import { elapsedText } from "../../shared/time/index.ts";
import { label } from "../consent.ts";
import type { AloneEnd, AloneRecord } from "./types.ts";

export const SHOW_RECORD = "show";

const ENDED: Readonly<Record<AloneEnd, string>> = {
  stopped: "You stopped it",
  time: "The time was up",
  locked: "The screen locked",
  logout: "You logged out",
};

const count = (n: number, one: string, many: string): string => `${n === 1 ? "1" : n} ${n === 1 ? one : many}`;

/** The sites agents touched, in the order they first did. */
export const touchedSites = (record: Pick<AloneRecord, "calls">): string[] => [...new Set(record.calls.flatMap((call) => call.sites))];

/** "14 actions on 2 sites, 9 without asking": what agents did while it ran. */
export function recordSummary(record: AloneRecord): string {
  const total = record.calls.length + record.more;
  if (total === 0) return "Agents did nothing";
  const sites = touchedSites(record).length;
  const free = record.calls.filter((call) => call.free).length;
  const did = `${count(total, "action", "actions")}${sites > 0 ? ` on ${count(sites, "site", "sites")}` : ""}`;
  return free > 0 ? `${did}, ${free} without asking` : did;
}

/** The notification when it ends: why, and what agents did, with Show (Settings › Agents). */
export function aloneNotice(record: AloneRecord): NotifyInput {
  return {
    appName: "Agents",
    appIcon: iconPath("agents"),
    summary: "Agents ask again",
    body: `${ENDED[record.why]}. ${recordSummary(record)} in ${elapsedText(record.ended - record.started)}.`,
    actions: [{ key: SHOW_RECORD, label: "Show" }],
    urgency: "normal",
    expireTimeout: -1,
    imagePath: "",
    desktopEntry: "",
    category: "dashi.agent",
    transient: false,
    resident: false,
  };
}

const clock = (ms: number, locale?: string): string => new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The whole record as text, for Show: when, what was allowed, and every call in order. */
export function recordText(record: AloneRecord, locale?: string): string {
  const lines = [
    "Agents worked alone",
    "",
    `From ${new Date(record.started).toLocaleString(locale)} to ${new Date(record.ended).toLocaleString(locale)} (${elapsedText(record.ended - record.started)}).`,
    `${ENDED[record.why]}.`,
    "",
    `Without asking: ${record.scopes.map(label).join(", ") || "nothing"}.`,
    `Sites without asking: ${record.sites.join(", ") || "none"}.`,
    "",
    `${recordSummary(record)}.`,
    "",
    ...record.calls.map((call) => {
      const how = call.outcome === "ok" ? "" : call.outcome === "error" ? " · failed" : " · given up";
      const sites = call.sites.length > 0 ? ` · ${call.sites.join(", ")}` : "";
      return `${clock(call.time, locale)}  ${call.agent}  ${call.tool}${sites}${how}${call.free ? " · without asking" : ""}`;
    }),
    ...(record.more > 0 ? [`… and ${record.more} more.`] : []),
  ];
  return `${lines.join("\n").trim()}\n`;
}
