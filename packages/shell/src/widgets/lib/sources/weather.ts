/**
 * Weather from Open-Meteo (free, no key, CC BY 4.0 data). Nothing about the
 * person leaves the computer but a place: the city of this computer's time
 * zone (or the one the person set) is looked up by name once, and only its
 * coordinates rounded to a tenth of a degree (about 11 km) are ever sent.
 * Asked every 30 minutes; the last answer is kept on disk, so a restart or a
 * lost network shows it as stale ("Updated 3 h ago") past two hours, and
 * "Weather isn't answering" when there has never been one.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Infer, lenientList, list, maybe, nullable, num, obj, str } from "@dashi/shape";
import { hereZone, zoneCity } from "../../../shared/calendar/index.ts";
import { writeTextAtomic } from "../../../shared/fs/index.ts";
import type { GlyphName } from "../../../shared/inks/index.ts";
import { Source } from "./source.ts";

export const WEATHER_EVERY_MS = 30 * 60_000;
export const WEATHER_STALE_MS = 2 * 60 * 60_000;

export interface WeatherNow {
  place: string;
  /** °C, rounded. */
  temperature: number;
  code: number;
  high: number;
  low: number;
  /** The first hour in the next 12 with a 50 % chance of rain or more (ms), or null. */
  rainFrom: number | null;
  /** When the answer came (ms). */
  at: number;
}

export type WeatherState = { status: "loading" } | { status: "down" } | { status: "ok" | "stale"; now: WeatherNow };

/** A tenth of a degree: what is sent, never more. */
export const roundCoordinate = (value: number): number => Math.round(value * 10) / 10;

const GEO = obj({ results: lenientList(obj({ name: str(), latitude: num(), longitude: num() }, { strict: false })) }, { strict: false });
const FORECAST = obj(
  {
    current: obj({ temperature_2m: num(), weather_code: num() }, { strict: false }),
    hourly: obj({ time: list(str()), precipitation_probability: list(nullable(num())) }, { strict: false }),
    daily: obj({ temperature_2m_max: list(num()), temperature_2m_min: list(num()) }, { strict: false }),
  },
  { strict: false },
);
const CACHE = obj({ place: str(), temperature: num(), code: num(), high: num(), low: num(), rainFrom: nullable(num()), at: num() });

/** The glyph and word for a WMO weather code. */
export function weatherLook(code: number): { glyph: GlyphName; words: string } {
  if (code === 0) return { glyph: "sun", words: "Clear" };
  if (code <= 2) return { glyph: "partly", words: "Partly cloudy" };
  if (code === 3) return { glyph: "cloud", words: "Cloudy" };
  if (code === 45 || code === 48) return { glyph: "fog", words: "Fog" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { glyph: "snow", words: "Snow" };
  if (code >= 95) return { glyph: "storm", words: "Thunder" };
  return { glyph: "rain", words: "Rain" };
}

/** The first hour from `now` in the next 12 with a 50 % chance of rain or more. */
export function firstRain(times: readonly string[], chances: readonly (number | null)[], now: number): number | null {
  for (const [i, time] of times.entries()) {
    const at = Date.parse(time);
    if (!Number.isFinite(at) || at + 3_600_000 <= now || at > now + 12 * 3_600_000) continue;
    if ((chances[i] ?? 0) >= 50) return at;
  }
  return null;
}

export type Fetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface WeatherOptions {
  fetch?: Fetch;
  /** The place's name; the time zone's city by default. */
  place?: string;
  cachePath?: string | null;
  now?: () => number;
}

export class Weather extends Source<WeatherState> {
  private readonly fetch: Fetch;
  private readonly now: () => number;
  private readonly cachePath: string | null;
  private readonly place: string;
  private coordinates: { latitude: number; longitude: number; name: string } | null = null;

  constructor(options: WeatherOptions = {}) {
    super({ status: "loading" });
    this.fetch = options.fetch ?? ((url) => fetch(url, { signal: AbortSignal.timeout(10_000) }));
    this.now = options.now ?? Date.now;
    this.place = options.place ?? zoneCity(hereZone());
    this.cachePath = options.cachePath === undefined ? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "dashi", "weather.json") : options.cachePath;
    const cached = this.readCache();
    if (cached) this.set({ status: this.now() - cached.at > WEATHER_STALE_MS ? "stale" : "ok", now: cached });
  }

  /** Asks now and every 30 minutes; the returned function stops. */
  start(): () => void {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), WEATHER_EVERY_MS);
    return () => clearInterval(timer);
  }

  async refresh(): Promise<void> {
    try {
      this.coordinates ??= await this.locate();
      if (!this.coordinates) throw new Error("no place");
      const { latitude, longitude, name } = this.coordinates;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${roundCoordinate(latitude)}&longitude=${roundCoordinate(longitude)}&current=temperature_2m,weather_code&hourly=precipitation_probability&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2&timeformat=unixtime`;
      const reply = await this.fetch(url);
      const body = reply.ok ? maybe(FORECAST, await reply.json()) : null;
      if (!body) throw new Error("no forecast");
      this.take(name, body);
    } catch {
      this.giveUp();
    }
  }

  private take(place: string, body: Infer<typeof FORECAST>): void {
    const now = this.now();
    // With timeformat=unixtime the hours are seconds: as ms strings for firstRain.
    const times = body.hourly.time.map((time) => (/^\d+$/.test(time) ? new Date(Number(time) * 1000).toISOString() : time));
    const answer: WeatherNow = {
      place,
      temperature: Math.round(body.current.temperature_2m),
      code: body.current.weather_code,
      high: Math.round(body.daily.temperature_2m_max[0] ?? body.current.temperature_2m),
      low: Math.round(body.daily.temperature_2m_min[0] ?? body.current.temperature_2m),
      rainFrom: firstRain(times, body.hourly.precipitation_probability, now),
      at: now,
    };
    this.set({ status: "ok", now: answer });
    this.writeCache(answer);
  }

  private giveUp(): void {
    const state = this.getSnapshot();
    if (state.status === "ok" || state.status === "stale") {
      if (this.now() - state.now.at > WEATHER_STALE_MS) this.set({ status: "stale", now: state.now });
    } else this.set({ status: "down" });
  }

  private async locate(): Promise<{ latitude: number; longitude: number; name: string } | null> {
    const reply = await this.fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(this.place)}`);
    const found = reply.ok ? maybe(GEO, await reply.json())?.results[0] : undefined;
    return found ? { latitude: found.latitude, longitude: found.longitude, name: found.name } : null;
  }

  private readCache(): WeatherNow | null {
    if (!this.cachePath || !existsSync(this.cachePath)) return null;
    try {
      return maybe(CACHE, JSON.parse(readFileSync(this.cachePath, "utf8")));
    } catch {
      return null;
    }
  }

  private writeCache(answer: WeatherNow): void {
    if (!this.cachePath) return;
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      writeTextAtomic(this.cachePath, JSON.stringify(answer));
    } catch {
      // A cache that cannot be written only costs the next start its first answer.
    }
  }
}
