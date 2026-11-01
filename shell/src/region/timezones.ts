/**
 * Time zones as the Date & Time pane lists them: the IANA names systemd
 * knows, each with a city, an area ("Europe"), a country when tzdata names
 * one, and the UTC offset right now. Pure; the tables are read by
 * `readZoneTables`, which a test replaces.
 */

import { readFileSync } from "node:fs";

/** What `ListTimezones` and settings may carry: `Europe/Berlin`, `America/Argentina/Buenos_Aires`, `UTC`. */
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]{0,31}(?:\/[A-Za-z0-9_+-]{1,32}){0,2}$/;

export const isTimezoneName = (value: unknown): value is string => typeof value === "string" && value.length <= 80 && ZONE_NAME.test(value);

export interface Zone {
  /** `America/Argentina/Buenos_Aires`. */
  id: string;
  /** "Europe"; "Other" for `UTC` and the like. */
  area: string;
  /** "Buenos Aires". */
  city: string;
  /** "Argentina", when tzdata's zone.tab names the country. */
  country: string | null;
  /** Minutes east of UTC at the time the list was built. */
  offset: number;
}

export interface ZoneTables {
  /** zone.tab: zone id to ISO 3166 country code. */
  countryOf: ReadonlyMap<string, string>;
  /** iso3166.tab: country code to name. */
  countryNames: ReadonlyMap<string, string>;
}

/** zone.tab's rows (`CC<TAB>coordinates<TAB>zone<TAB>comment`), comments skipped. */
export function parseZoneTab(text: string): Map<string, string> {
  const zones = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) continue;
    const [country, , zone] = line.split("\t");
    if (country && zone && /^[A-Z]{2}$/.test(country) && isTimezoneName(zone)) zones.set(zone, country);
  }
  return zones;
}

/** iso3166.tab's rows (`CC<TAB>name`). */
export function parseIso3166(text: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) continue;
    const [code, name] = line.split("\t");
    if (code && name && /^[A-Z]{2}$/.test(code)) names.set(code, name.trim());
  }
  return names;
}

/** tzdata's tables from `dir`; empty maps when they are not installed (the list still works, without countries). */
export function readZoneTables(dir = "/usr/share/zoneinfo"): ZoneTables {
  const read = (file: string): string => {
    try {
      return readFileSync(`${dir}/${file}`, "utf8");
    } catch {
      return "";
    }
  };
  return { countryOf: parseZoneTab(read("zone.tab")), countryNames: parseIso3166(read("iso3166.tab")) };
}

/** Minutes east of UTC that `zone` is at `at`; 0 for a name Intl does not know. */
export function offsetMinutes(zone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(at);
    const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
    if (!match) return 0;
    const [, sign, hours, minutes] = match;
    const total = Number(hours ?? 0) * 60 + Number(minutes ?? 0);
    return sign === "-" ? -total : total;
  } catch {
    return 0;
  }
}

/** "GMT+5:30", "GMT-8", "GMT". */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return "GMT";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const [hours, rest] = [Math.floor(abs / 60), abs % 60];
  return `GMT${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/** The areas of real places; `Etc/GMT+5` and the old `US/Pacific` names are not listed. */
const PLACE_AREAS = ["Africa", "America", "Antarctica", "Arctic", "Asia", "Atlantic", "Australia", "Europe", "Indian", "Pacific"];

/**
 * The zones for `ids` by area and then city. Names that are not a place a person lives (`Etc/*`),
 * the old duplicates (`US/Pacific`, `Asia/Calcutta` when tzdata's own table lists `Asia/Kolkata`),
 * and invalid names are dropped, except the zones in `keep` (the one the system has now).
 */
export function buildZones(ids: readonly string[], tables: ZoneTables, at: Date = new Date(), keep: readonly string[] = []): Zone[] {
  const zones: Zone[] = [];
  const canonical = tables.countryOf.size > 0;
  for (const id of new Set([...ids, ...keep])) {
    if (!isTimezoneName(id)) continue;
    const parts = id.split("/");
    const place = parts.length > 1 ? PLACE_AREAS.includes(parts[0] as string) && (!canonical || tables.countryOf.has(id)) : id === "UTC";
    if (!place && !keep.includes(id)) continue;
    const area = parts.length > 1 ? (parts[0] as string) : "Other";
    const city = (parts.at(-1) as string).replaceAll("_", " ");
    const code = tables.countryOf.get(id);
    zones.push({ id, area, city, country: code ? (tables.countryNames.get(code) ?? null) : null, offset: offsetMinutes(id, at) });
  }
  return zones.sort((a, b) => a.area.localeCompare(b.area) || a.city.localeCompare(b.city));
}

/** The areas that have zones, in the order they sort. */
export const zoneAreas = (zones: readonly Zone[]): string[] => [...new Set(zones.map((zone) => zone.area))].sort((a, b) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));

const fold = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Zones whose city, country, area, or id contain every word of `query`, best first: a city that
 * starts with the query before one that only contains it. `area` narrows an empty query to one
 * area; a typed query searches everywhere.
 */
export function searchZones(zones: readonly Zone[], query: string, area?: string): Zone[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return area === undefined ? [...zones] : zones.filter((zone) => zone.area === area);
  const rank = (zone: Zone): number | null => {
    const city = fold(zone.city);
    const rest = fold(`${zone.id.replaceAll("_", " ")} ${zone.country ?? ""} ${formatOffset(zone.offset)}`);
    if (!words.every((word) => city.includes(word) || rest.includes(word))) return null;
    if (city === words.join(" ")) return 0;
    return city.startsWith(words[0] as string) ? 1 : city.includes(words[0] as string) ? 2 : 3;
  };
  return zones
    .flatMap((zone) => {
      const score = rank(zone);
      return score === null ? [] : [{ zone, score }];
    })
    .sort((a, b) => a.score - b.score || a.zone.city.localeCompare(b.zone.city))
    .map((hit) => hit.zone);
}

/** The line under a zone's name: its country (if any) and its offset. */
export const describeZone = (zone: Zone): string => [zone.country, formatOffset(zone.offset)].filter(Boolean).join(" · ");
