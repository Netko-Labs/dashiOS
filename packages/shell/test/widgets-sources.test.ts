import { describe, expect, test } from "bun:test";
import { parseWidgetTree } from "@dashi/applet";
import { extensionWidgets } from "../src/widgets/lib/sources/extensions.ts";
import { cpuTimes, memory } from "../src/widgets/lib/sources/system.ts";
import { type TimerClock, Timers, timeLeft } from "../src/widgets/lib/sources/timer.ts";
import { firstRain, roundCoordinate, Weather, weatherLook } from "../src/widgets/lib/sources/weather.ts";

function clock() {
  let now = 1_000_000;
  let wakes: { at: number; run: () => void }[] = [];
  const c: TimerClock = {
    now: () => now,
    at: (at, run) => {
      const wake = { at, run };
      wakes.push(wake);
      return () => {
        wakes = wakes.filter((w) => w !== wake);
      };
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const wake of wakes.filter((w) => w.at <= now)) {
      wakes = wakes.filter((w) => w !== wake);
      wake.run();
    }
  };
  return { c, advance, now: () => now };
}

describe("timers", () => {
  test("a running timer is on air as running with its countdown; at zero it is due and rings once", () => {
    const t = clock();
    const rang: string[] = [];
    const timers = new Timers((timer) => rang.push(timer.label), t.c);
    const tea = timers.start("Tea", 3);
    expect(timers.onAir()[0]).toMatchObject({ key: `timer:${tea.id}`, reason: "running", countdown: t.now() + 180_000, ink: "wakame" });
    t.advance(180_000);
    expect(rang).toEqual(["Tea"]);
    expect(timers.onAir()[0]).toMatchObject({ reason: "due", deadline: t.now() });
  });

  test("pause keeps what is left; resume and +1 min move the end", () => {
    const t = clock();
    const timers = new Timers(() => {}, t.c);
    const tea = timers.start("Tea", 3);
    t.advance(60_000);
    timers.pause(tea.id);
    t.advance(600_000);
    const paused = timers.getSnapshot()[0];
    expect(paused && timeLeft(paused, t.now())).toBe(120_000);
    timers.resume(tea.id);
    timers.addMinute(tea.id);
    const running = timers.getSnapshot()[0];
    expect(running && timeLeft(running, t.now())).toBe(180_000);
    timers.stop(tea.id);
    expect(timers.onAir()).toEqual([]);
  });
});

describe("weather", () => {
  test("only a tenth of a degree is ever sent", () => {
    expect(roundCoordinate(38.71667)).toBe(38.7);
    expect(roundCoordinate(-9.13333)).toBe(-9.1);
  });

  test("rain's hour is the first in the next 12 with a 50 % chance or more", () => {
    const now = Date.parse("2026-11-15T14:00:00Z");
    const times = ["2026-11-15T14:00:00Z", "2026-11-15T17:00:00Z", "2026-11-15T18:00:00Z"];
    expect(firstRain(times, [10, 40, 70], now)).toBe(Date.parse("2026-11-15T18:00:00Z"));
    expect(firstRain(times, [10, 40, null], now)).toBeNull();
  });

  test("codes read as glyphs and words", () => {
    expect(weatherLook(0).glyph).toBe("sun");
    expect(weatherLook(63)).toEqual({ glyph: "rain", words: "Rain" });
  });

  test("the URLs carry the place's name once and rounded coordinates; a failure with nothing kept is down", async () => {
    const asked: string[] = [];
    const weather = new Weather({
      cachePath: null,
      place: "Lisbon",
      now: () => 0,
      fetch: async (url) => {
        asked.push(url);
        if (url.includes("geocoding")) return { ok: true, json: async () => ({ results: [{ name: "Lisbon", latitude: 38.71667, longitude: -9.13333 }] }) };
        return { ok: false, json: async () => null };
      },
    });
    await weather.refresh();
    expect(asked[1]).toContain("latitude=38.7&longitude=-9.1&");
    expect(weather.getSnapshot()).toEqual({ status: "down" });
  });
});

test("an answer as Open-Meteo sends it (unixtime hours) is read: temperature, range, rain's hour", async () => {
  const now = Date.parse("2026-11-17T14:00:00Z");
  const hour = (h: number) => Date.parse(`2026-11-17T${String(h).padStart(2, "0")}:00:00Z`) / 1000;
  const weather = new Weather({
    cachePath: null,
    place: "Lisbon",
    now: () => now,
    fetch: async (url) =>
      url.includes("geocoding")
        ? { ok: true, json: async () => ({ results: [{ name: "Lisbon", latitude: 38.7, longitude: -9.1 }] }) }
        : {
            ok: true,
            json: async () => ({
              current: { time: hour(14), temperature_2m: 19.4, weather_code: 2 },
              hourly: { time: [hour(14), hour(17), hour(18)], precipitation_probability: [5, 30, 80] },
              daily: { time: [hour(0)], temperature_2m_max: [21.2], temperature_2m_min: [12.8] },
            }),
          },
  });
  await weather.refresh();
  expect(weather.getSnapshot()).toEqual({ status: "ok", now: { place: "Lisbon", temperature: 19, code: 2, high: 21, low: 13, rainFrom: hour(18) * 1000, at: now } });
});

describe("system numbers", () => {
  test("processor and memory from /proc", () => {
    expect(cpuTimes("cpu  100 0 100 700 100 0 0 0 0 0\n")).toEqual({ busy: 200, total: 1000 });
    expect(memory("MemTotal: 33554432 kB\nMemAvailable: 20971520 kB\n")).toEqual({ used: 12, total: 32 });
  });
});

describe("an outside extension's widget", () => {
  const tree = {
    t: "Widget",
    i: "w",
    p: { title: "Lights" },
    c: [
      { t: "Value", i: "v", p: { text: "2", unit: "/3" } },
      { t: "Dots", i: "d", p: { count: 3, value: 2 } },
    ],
  };

  test("its tree is Dashi's elements, rooted at Widget; a launcher element or a view root is refused", () => {
    expect("error" in (parseWidgetTree(tree) as object)).toBe(false);
    expect(parseWidgetTree({ t: "List", i: "l" })).toMatchObject({ error: expect.any(String) });
    expect(parseWidgetTree({ ...tree, c: [{ t: "Item", i: "x", p: { title: "x" } }] })).toMatchObject({ error: expect.any(String) });
  });

  test("it prints in plain ink whatever it says, and only when allowed and not disabled", () => {
    const manifest = {
      id: "dev.example.lights",
      name: "Lights",
      widgets: [{ id: "lights", title: "Lights", sizes: ["small"], privacy: "none" }],
      permissions: [],
      commands: [],
    };
    const applet = (consent: string[], disabled?: { reason: "off" }) => ({
      manifest: manifest as never,
      record: { version: "0.1.0", sha256: "", authorKey: null, source: "local" as const, consent, ...(disabled ? { disabled } : {}) },
      dir: "/nonexistent",
    });
    const [widget] = extensionWidgets([applet([])], "/nonexistent");
    expect(widget?.info).toMatchObject({ kind: "ext:dev.example.lights/lights", ink: null, holdsPrivate: false });
    expect(widget?.tree).toEqual({ error: "no tree yet" });
    expect(extensionWidgets([applet([], { reason: "off" })], "/nonexistent")).toEqual([]);
  });
});
