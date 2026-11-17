import { describe, expect, test } from "bun:test";
import { foldGroups } from "../src/notifications/lib/ceiling.ts";
import type { NotificationGroup } from "../src/notifications/lib/group.ts";
import type { HistoryEntry } from "../src/notifications/types.ts";
import type { OnAirItem, TallyView } from "../src/tally/index.ts";
import { COLUMN_WIDTH, type Placement, packColumn } from "../src/widgets/index.ts";
import { foldLive, liveItems } from "../src/widgets/lib/live-fold.ts";
import { type RundownRow, rundownHero, rundownRows } from "../src/widgets/lib/rundown.ts";

const placement = (id: string, size: Placement["size"], kind: Placement["kind"] = "clock"): Placement => ({ id, kind, size });

describe("the widget column", () => {
  test("is 356 wide: four 80-point cells, 12 apart", () => {
    expect(COLUMN_WIDTH).toBe(356);
  });

  test("two smalls next to each other sit side by side; a wide goes under them", () => {
    const placed = packColumn([placement("a", "large"), placement("b", "small"), placement("c", "small"), placement("d", "wide")]);
    expect(placed.map(({ x, y, width, height }) => [x, y, width, height])).toEqual([
      [0, 0, 356, 356],
      [0, 368, 172, 172],
      [184, 368, 172, 172],
      [0, 552, 356, 172],
    ]);
  });

  test("a widget never goes above one placed before it", () => {
    const placed = packColumn([placement("a", "small"), placement("b", "wide"), placement("c", "mini")]);
    expect(placed[2]?.y).toBeGreaterThanOrEqual(placed[1]?.y ?? 0);
  });
});

const entry = (id: number, app: string): HistoryEntry => ({
  id,
  appName: app,
  appIcon: "",
  summary: "Hi",
  body: "",
  actions: [],
  urgency: "normal",
  expireTimeout: -1,
  imagePath: "",
  desktopEntry: "",
  category: "",
  transient: false,
  resident: false,
  time: id,
  revision: 0,
  sender: "",
});
const group = (app: string, count: number): NotificationGroup => ({ key: app, name: app, entries: Array.from({ length: count }, (_, i) => entry(i, app)) });

describe("the area's ceiling", () => {
  test("at most three notification groups, then one line naming how many and from which apps", () => {
    const groups = ["Calendar", "Messages", "Files", "Helium", "Signal"].map((app, i) => group(app, i + 1));
    const folded = foldGroups(groups);
    expect(folded.shown.map((each) => each.name)).toEqual(["Calendar", "Messages", "Files"]);
    expect(folded.more).toEqual({ count: 9, apps: ["Helium", "Signal"] });
    expect(foldGroups(groups, true).more).toBeNull();
    expect(foldGroups(groups.slice(0, 3)).more).toBeNull();
  });

  const item = (key: string): OnAirItem => ({ key, reason: "running", since: 0, label: key, glyph: "timer", ink: null });
  const view = (keys: string[]): TallyView => ({
    holder: keys[0] ?? null,
    item: keys[0] ? item(keys[0]) : null,
    standby: keys.slice(1).map(item),
    houseDown: false,
    pinned: null,
  });

  test("more than two live items: the holder and one on standby show, the rest fold into one row", () => {
    const live = liveItems(view(["timer:t1", "run:r1", "timer:t2", "ask:q1", "run:r2", "timer:t3"]), []);
    const { cards, folded } = foldLive(live);
    expect(cards.map((each) => each.key)).toEqual(["timer:t1", "run:r1"]);
    expect(folded.map((each) => each.key)).toEqual(["timer:t2", "ask:q1", "run:r2", "timer:t3"]);
    expect(foldLive(live.slice(0, 2)).folded).toEqual([]);
  });

  test("music and events stay in their widgets when those are placed; otherwise they are live cards", () => {
    expect(liveItems(view(["media:x", "event:e"]), ["media", "calendar"])).toEqual([]);
    expect(liveItems(view(["media:x", "event:e"]), []).map((each) => each.key)).toEqual(["media:x", "event:e"]);
  });
});

describe("the Rundown", () => {
  const now = Date.parse("2026-11-15T14:02:00");
  const row = (at: string, source: RundownRow["source"], title: string): RundownRow => ({
    at: Date.parse(`2026-11-15T${at}:00`),
    title,
    detail: "",
    source,
    ink: source === "calendar" ? "miso" : source === "weather" ? "mizu" : source === "timer" ? "wakame" : "shiso",
    glyph: "cal",
    private: source === "calendar",
  });
  const rows = [
    row("15:00", "calendar", "Design review"),
    row("16:40", "timer", "Laundry"),
    row("17:30", "calendar", "Call with Alex Kim"),
    row("18:00", "weather", "Rain"),
    row("21:00", "agents", "Weekly backup"),
  ];
  const clock = (at: number) => new Date(at).toTimeString().slice(0, 5);

  test("the hero is the next event and how long until it, in its ink", () => {
    const hero = rundownHero(rows, now, clock);
    expect([hero.value, hero.unit, hero.title, hero.ink]).toEqual(["58", "min", "to Design review", "miso"]);
  });

  test("the list leaves out the hero and what a placed widget shows (#24)", () => {
    const hero = rundownHero(rows, now, clock);
    const shown = rundownRows(rows, ["weather", "battery"], hero, now, 4);
    expect(shown.map((each) => each.title)).toEqual(["Laundry", "Call with Alex Kim", "Weekly backup"]);
  });
});
