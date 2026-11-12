/**
 * Time zones. A timed event keeps the zone it was written in (DTSTART;TZID):
 * its start and end are wall-clock times there, and the grid shows them on
 * this computer's clock. Fly to Lisbon and the 9:00 New York call moves to
 * 14:00; a floating time (no zone, as an all-day event has) stays where it
 * is written. Zones are IANA names ("America/New_York"), and "UTC" for a time
 * written with a Z. A zone this computer does not know is kept as written and
 * shown as floating time. Pure, apart from `hereZone`, which reads the
 * process's zone once.
 */

import { type Local, MINUTE, parseLocal } from "./dates.ts";

export const UTC = "UTC";

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(zone: string): Intl.DateTimeFormat | null {
  let found = formatters.get(zone);
  if (found !== undefined) return found;
  found = null;
  // IANA names are letters, digits, and `_ + - /`; anything else is not looked up.
  if (/^[A-Za-z0-9_+\-/]{1,64}$/.test(zone)) {
    try {
      found = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      found = null;
    }
  }
  formatters.set(zone, found);
  return found;
}

/** A zone this computer can convert ("Europe/Lisbon", "UTC"). */
export const isZone = (value: unknown): value is string => typeof value === "string" && formatter(value) !== null;

let here: string | null = null;

/** This computer's zone, as the process sees it (read once). */
export function hereZone(): string {
  if (here === null) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    here = zone && isZone(zone) ? zone : UTC;
  }
  return here;
}

/** The wall clock in `zone` at an instant (milliseconds since the epoch), or null for a zone this computer does not know. */
export function wallAt(instant: number, zone: string): Local | null {
  const format = formatter(zone);
  if (!format || !Number.isFinite(instant)) return null;
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(new Date(instant))) parts[part.type] = part.value;
  const year = (parts.year ?? "").padStart(4, "0");
  return `${year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

/** Minutes `zone` is ahead of UTC at an instant. */
function offsetAt(instant: number, zone: string): number | null {
  const wall = wallAt(instant, zone);
  const asUtc = wall === null ? null : parseLocal(wall);
  return asUtc === null ? null : Math.round((asUtc - Math.floor(instant / MINUTE) * MINUTE) / MINUTE);
}

/**
 * The instant a wall-clock time in `zone` is, or null. A time that happens
 * twice (the hour a clock goes back) is the first; a time that never
 * happens (the hour it goes forward) moves forward by the change.
 */
export function instantIn(wall: Local, zone: string): number | null {
  const guess = parseLocal(wall);
  if (guess === null || !isZone(zone)) return null;
  // A clock changes at most once in two days: the offsets a day either side are the two it can be.
  const before = offsetAt(guess - 86_400_000, zone);
  const after = offsetAt(guess + 86_400_000, zone);
  if (before === null || after === null) return null;
  const candidates = [...new Set([guess - before * MINUTE, guess - after * MINUTE])].sort((a, b) => a - b);
  return candidates.find((instant) => wallAt(instant, zone) === wall) ?? (candidates.at(-1) as number);
}

/**
 * A wall-clock time in `from` as the wall clock in `to`. Floating time (no
 * zone), the same zone, or a zone either side does not know: the same text.
 */
export function convertWall(wall: Local, from: string | null, to: string): Local {
  if (from === null || from === to) return wall;
  const instant = instantIn(wall, from);
  if (instant === null) return wall;
  return wallAt(instant, to) ?? wall;
}

/** The wall clock an event's time (in `zone`) shows here. */
export const toHere = (wall: Local, zone: string | null, local: string = hereZone()): Local => convertWall(wall, zone, local);

/** A time on this computer's clock as the wall clock in an event's `zone`. */
export const fromHere = (wall: Local, zone: string | null, local: string = hereZone()): Local => (zone === null ? wall : convertWall(wall, local, zone));

/** The zone's name as a place: "America/New_York" is "New York", "UTC" stays. */
export function zoneCity(zone: string): string {
  const last = zone.split("/").at(-1) ?? zone;
  return last.replaceAll("_", " ");
}

/** Every zone this computer knows, for the event sheet's field (UTC first). */
export function knownZones(): string[] {
  const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [UTC, ...list.filter((zone) => zone !== UTC)];
}

/**
 * A zone as typed into the sheet: an IANA name in any case ("europe/lisbon"),
 * or a city ("Lisbon", "new york"). Null when nothing matches.
 */
export function parseZone(text: string, zones: readonly string[] = knownZones()): string | null {
  const typed = text.trim().replaceAll(" ", "_").toLowerCase();
  if (typed === "") return null;
  const exact = zones.find((zone) => zone.toLowerCase() === typed);
  if (exact) return exact;
  return zones.find((zone) => (zone.split("/").at(-1) ?? "").toLowerCase() === typed) ?? null;
}
