/**
 * Places and their time zones for the answer row ("time in lisbon", "3pm
 * tokyo"): every IANA zone by its city ("Lisbon", "Sao Paulo", "New York"),
 * places tzdata files under another city ("san francisco" is Los Angeles),
 * and the abbreviations people type (pst, cet, utc). The time arithmetic is
 * here too: a zone's offset at an instant, and the instant a wall-clock time
 * in a zone stands for.
 */

/** Places and abbreviations tzdata doesn't name a zone after. */
const ALIASES: Readonly<Record<string, string>> = {
  utc: "UTC",
  gmt: "UTC",
  zulu: "UTC",
  est: "America/New_York",
  edt: "America/New_York",
  et: "America/New_York",
  cst: "America/Chicago",
  cdt: "America/Chicago",
  mst: "America/Denver",
  mdt: "America/Denver",
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
  pt: "America/Los_Angeles",
  bst: "Europe/London",
  cet: "Europe/Paris",
  cest: "Europe/Paris",
  eet: "Europe/Athens",
  jst: "Asia/Tokyo",
  kst: "Asia/Seoul",
  ist: "Asia/Kolkata",
  aest: "Australia/Sydney",
  nyc: "America/New_York",
  "new york city": "America/New_York",
  la: "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  sf: "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  "silicon valley": "America/Los_Angeles",
  boston: "America/New_York",
  washington: "America/New_York",
  miami: "America/New_York",
  atlanta: "America/New_York",
  dallas: "America/Chicago",
  houston: "America/Chicago",
  austin: "America/Chicago",
  montreal: "America/Toronto",
  ottawa: "America/Toronto",
  "rio de janeiro": "America/Sao_Paulo",
  rio: "America/Sao_Paulo",
  beijing: "Asia/Shanghai",
  shenzhen: "Asia/Shanghai",
  delhi: "Asia/Kolkata",
  "new delhi": "Asia/Kolkata",
  mumbai: "Asia/Kolkata",
  bangalore: "Asia/Kolkata",
  bengaluru: "Asia/Kolkata",
  osaka: "Asia/Tokyo",
  kyoto: "Asia/Tokyo",
  barcelona: "Europe/Madrid",
  porto: "Europe/Lisbon",
  munich: "Europe/Berlin",
  frankfurt: "Europe/Berlin",
  hamburg: "Europe/Berlin",
  milan: "Europe/Rome",
  geneva: "Europe/Zurich",
  edinburgh: "Europe/London",
  manchester: "Europe/London",
  "st petersburg": "Europe/Moscow",
  "saint petersburg": "Europe/Moscow",
  "tel aviv": "Asia/Jerusalem",
  melbourne: "Australia/Melbourne",
  canberra: "Australia/Sydney",
  wellington: "Pacific/Auckland",
};

/** Lower case, accents off, one space: "São Paulo" is "sao paulo". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .trim();
}

let cities: Map<string, string> | null = null;

/** Every zone Intl knows, by its city's folded name (made once). */
function zoneCities(): Map<string, string> {
  if (cities) return cities;
  cities = new Map();
  for (const zone of Intl.supportedValuesOf("timeZone")) {
    const city = zone.split("/").at(-1);
    if (city && zone.includes("/")) cities.set(fold(city), zone);
  }
  return cities;
}

/** The zone a typed place names, with how to call it ("Lisbon", "PST"); null for none. */
export function zoneNamed(typed: string): { zone: string; place: string } | null {
  const name = fold(typed);
  if (!name) return null;
  const alias = ALIASES[name];
  if (alias) return { zone: alias, place: name.length <= 4 ? name.toUpperCase() : titleCase(name) };
  const zone = zoneCities().get(name);
  return zone ? { zone, place: (zone.split("/").at(-1) as string).replace(/_/g, " ") } : null;
}

const titleCase = (text: string): string => text.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());

const parts = new Map<string, Intl.DateTimeFormat>();

/** A zone's wall clock at `instant`: year, month (1–12), day, hour (0–23), minute. */
export function wallClock(instant: number, zone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  let format = parts.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    parts.set(zone, format);
  }
  const values = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]));
  const number = (key: string): number => Number(values[key] ?? 0);
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour") % 24, minute: number("minute") };
}

/** Minutes `zone` is ahead of UTC at `instant`. */
export function offsetMinutes(instant: number, zone: string): number {
  const wall = wallClock(instant, zone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return Math.round((asUtc - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

/** The instant it is `hour:minute` on `zone`'s calendar day at `near` (that day, in that zone). */
export function instantAt(near: number, zone: string, hour: number, minute: number): number {
  const day = wallClock(near, zone);
  const wall = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  // Twice: the offset at the guess can differ from the offset at the answer across a clock change.
  let instant = wall - offsetMinutes(wall, zone) * 60_000;
  instant = wall - offsetMinutes(instant, zone) * 60_000;
  return instant;
}

/** The calendar days from `from`'s date to `to`'s (−1, 0, 1), each read on its own zone's calendar. */
export function dayDifference(instant: number, from: string, to: string): number {
  const a = wallClock(instant, from);
  const b = wallClock(instant, to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}
