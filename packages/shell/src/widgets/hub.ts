/**
 * The widgets' sources in one place, started once by the shell
 * (boot/inks.ts): timers, weather, music, the machine's load, and what the
 * calendar, agents' runs and Dashi's asks say. It puts what is live on the
 * tally (tally/), and the area, the lock screen, Glance and agents' tools all
 * read the same sources.
 */

import { calendarBridge } from "../calendar/index.ts";
import type { NotifyInput } from "../notifications/index.ts";
import { addDays, dayOf, type Occurrence } from "../shared/calendar/index.ts";
import type { PillAsk } from "../shared/pill/index.ts";
import { systemTally, type TallyStore } from "../tally/index.ts";
import { asksOnAir, eventsOnAir, mediaOnAir, runsOnAir } from "./lib/on-air.ts";
import { Media } from "./lib/sources/media.ts";
import { SystemLoad } from "./lib/sources/system.ts";
import { Timers } from "./lib/sources/timer.ts";
import { Weather } from "./lib/sources/weather.ts";
import { WidgetStore } from "./store.ts";

type RunLike = Parameters<typeof runsOnAir>[0][number];

export interface HubNeeds {
  notify(input: NotifyInput): void;
  runs?: { subscribe(listener: () => void): () => void; getSnapshot(): readonly RunLike[] };
  asks?: { subscribe(listener: () => void): () => void; getSnapshot(): readonly PillAsk[] };
  tally?: TallyStore;
  /** Off in tests: no network, no bus. */
  live?: boolean;
}

export class WidgetHub {
  readonly store = new WidgetStore();
  readonly timers: Timers;
  readonly weather = new Weather();
  readonly media = new Media(null);
  readonly load = new SystemLoad(null);
  readonly tally: TallyStore;
  private readonly stops: (() => void)[] = [];

  constructor(private readonly needs: HubNeeds) {
    this.tally = needs.tally ?? systemTally();
    this.timers = new Timers((timer) =>
      needs.notify({
        appName: "Timer",
        appIcon: "",
        summary: `${timer.label} is ready`,
        body: `${Math.round(timer.total / 60_000)} minutes, done.`,
        actions: [],
        urgency: "normal",
        expireTimeout: -1,
        imagePath: "",
        desktopEntry: "",
        category: "dashi.timer",
        transient: false,
        resident: false,
      }),
    );
  }

  /** Today's and tomorrow's occurrences, hidden calendars left out. */
  occurrences(): Occurrence[] {
    const day = dayOf(new Date());
    return calendarBridge()?.occurrences(day, addDays(day, 2)) ?? [];
  }

  start(): () => void {
    const feed = () => {
      const now = Date.now();
      this.tally.set("timers", this.timers.onAir(now));
      this.tally.set("media", mediaOnAir(this.media.getSnapshot()));
      this.tally.set("calendar", eventsOnAir(this.occurrences(), now));
      this.tally.set("runs", runsOnAir(this.needs.runs?.getSnapshot() ?? [], now));
      this.tally.set("asks", asksOnAir(this.needs.asks?.getSnapshot() ?? []));
    };
    for (const source of [this.timers, this.media]) this.stops.push(source.subscribe(feed));
    if (this.needs.runs) this.stops.push(this.needs.runs.subscribe(feed));
    if (this.needs.asks) this.stops.push(this.needs.asks.subscribe(feed));
    const bridge = calendarBridge();
    if (bridge) this.stops.push(bridge.subscribe(feed));
    // Events come due by the clock alone: look every 30 s.
    const minute = setInterval(feed, 30_000);
    this.stops.push(() => clearInterval(minute));
    if (this.needs.live !== false) {
      this.stops.push(this.weather.start(), this.media.start());
    }
    feed();
    return () => {
      for (const stop of this.stops.splice(0)) stop();
      this.load.watch(false);
    };
  }
}

let current: WidgetHub | null = null;

/** The shell's one hub, once started (boot/inks.ts); null in a test or a run that started none. */
export const widgetHub = (): WidgetHub | null => current;

export function setWidgetHub(hub: WidgetHub | null): void {
  current = hub;
}
