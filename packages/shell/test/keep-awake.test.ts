import { afterEach, expect, test } from "bun:test";
import type { CompositorEvent } from "../src/compositor.ts";
import { IdlePolicy } from "../src/idle.ts";
import { awakeLines, InhibitFlag, InhibitStore, keepAwakeEntries, screenSaverInterface } from "../src/inhibit/index.ts";
import { portalHostInterface } from "../src/portal-host/index.ts";
import { type FakeClock, fakeClock } from "./support/time.ts";

let clock: FakeClock | null = null;
afterEach(() => clock?.restore());

const call = (sender: string) => ({ sender, path: "/", interface: undefined, member: "" });

test("holds: taken and released by their owner, all of an owner's at once, ids never 0", () => {
  const store = new InhibitStore(() => 1000);
  const video = store.add({ owner: ":1.5", appId: "org.mozilla.firefox", reason: "Playing video", flags: InhibitFlag.idle, via: "portal" });
  const backup = store.add({ owner: ":1.6", appId: "backup", reason: "Copying", flags: InhibitFlag.suspend, via: "portal" });
  expect(video).toBe(1);
  expect(store.blocks(InhibitFlag.idle)).toBe(true);
  expect(store.blocks(InhibitFlag.suspend)).toBe(true);
  // Someone else's cookie does nothing.
  expect(store.release(video ?? 0, ":1.6")).toBe(false);
  expect(store.release(video ?? 0, ":1.5")).toBe(true);
  expect(store.blocks(InhibitFlag.idle)).toBe(false);
  store.add({ owner: ":1.6", appId: "backup", reason: "Again", flags: InhibitFlag.idle | InhibitFlag.logout, via: "screensaver" });
  expect(store.releaseOwner(":1.6")).toBe(2);
  expect(store.getSnapshot()).toEqual([]);
  expect(backup).toBe(2);
});

test("holds: one owner can't take unlimited holds, flags are masked and text cleaned", () => {
  const store = new InhibitStore();
  for (let i = 0; i < 32; i++) expect(store.add({ owner: ":1.9", appId: "spam", reason: "", flags: 8, via: "screensaver" })).not.toBeNull();
  expect(store.add({ owner: ":1.9", appId: "spam", reason: "", flags: 8, via: "screensaver" })).toBeNull();
  const other = new InhibitStore();
  other.add({ owner: ":1.1", appId: "a\u0000b", reason: "line\nbreak", flags: 0xff, via: "portal" });
  expect(other.getSnapshot()[0]).toMatchObject({ appId: "a b", reason: "line break", flags: 15 });
});

test("Allow Sleep ignores the holds there are now, not ones taken later", () => {
  const store = new InhibitStore();
  store.add({ owner: ":1.5", appId: "mpv", reason: "Playing", flags: InhibitFlag.idle, via: "screensaver" });
  store.ignoreAll();
  expect(store.blocks(InhibitFlag.idle)).toBe(false);
  expect(store.awake()).toEqual([]);
  store.add({ owner: ":1.5", appId: "mpv", reason: "Next", flags: InhibitFlag.idle, via: "screensaver" });
  expect(store.blocks(InhibitFlag.idle)).toBe(true);
});

test("the battery menu lists each app once, with its reason, then Allow Sleep", () => {
  const store = new InhibitStore();
  store.add({ owner: ":1.5", appId: "firefox", reason: "Playing video", flags: InhibitFlag.idle, via: "screensaver" });
  store.add({ owner: ":1.5", appId: "firefox", reason: "Audio", flags: InhibitFlag.idle, via: "screensaver" });
  store.add({ owner: ":1.7", appId: "", reason: "", flags: InhibitFlag.suspend, via: "portal" });
  store.add({ owner: ":1.8", appId: "logout-only", reason: "", flags: InhibitFlag.logout, via: "portal" });
  const name = (id: string) => (id === "firefox" ? "Firefox" : "");
  expect(awakeLines(store.awake(), name)).toEqual(["Firefox · Playing video", "An app"]);
  const entries = keepAwakeEntries(store.awake(), name, "allow");
  expect(entries.map((entry) => (entry.kind === "item" ? entry.label : "—"))).toEqual([
    "—",
    "Keeping the Screen Awake",
    "    Firefox · Playing video",
    "    An app",
    "Allow Sleep",
  ]);
  expect(entries.at(-1)).toMatchObject({ action: "allow" });
  expect(keepAwakeEntries([], name, "allow")).toEqual([]);
});

function fakeCompositor() {
  const listeners = new Set<(event: CompositorEvent) => void>();
  const sent: Array<[string, unknown]> = [];
  return {
    sent,
    emit: (event: CompositorEvent) => {
      for (const listener of listeners) listener(event);
    },
    host: {
      request: async (method: string, params?: Record<string, unknown>) => {
        sent.push([method, params]);
        return {};
      },
      on: (listener: (event: CompositorEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

test("idle: a hold keeps the screens on and the computer up; once it goes, the wait starts again", async () => {
  clock = fakeClock();
  const fake = fakeCompositor();
  const idle = new IdlePolicy(fake.host);
  let held = true;
  let slept = 0;
  idle.onSleep = () => slept++;
  idle.holdWith({ screen: () => held, sleep: () => false });
  await idle.blankAfter(0.02);
  await idle.sleepAfter(0.04);
  fake.emit({ event: "idle", seconds: 0.02 });
  fake.emit({ event: "idle", seconds: 0.04 });
  await clock.advance(5);
  expect(fake.sent.filter(([method]) => method === "power")).toEqual([]);
  expect(slept).toBe(0);
  held = false;
  idle.holdsChanged();
  // Not at once: after the full wait, counted from the release.
  await clock.advance(5);
  expect(fake.sent.filter(([method]) => method === "power")).toEqual([]);
  await clock.advance(60);
  expect(fake.sent.filter(([method]) => method === "power")).toEqual([["power", { on: false }]]);
  expect(slept).toBe(1);
  idle.stop();
});

test("idle: coming back cancels a wait counted after a release", async () => {
  clock = fakeClock();
  const fake = fakeCompositor();
  const idle = new IdlePolicy(fake.host);
  let held = true;
  idle.holdWith({ screen: () => held, sleep: () => false });
  await idle.blankAfter(0.02);
  fake.emit({ event: "idle", seconds: 0.02 });
  held = false;
  idle.holdsChanged();
  fake.emit({ event: "active" });
  await clock.advance(40);
  expect(fake.sent.filter(([method]) => method === "power")).toEqual([]);
  idle.stop();
});

test("ScreenSaver: Inhibit gives a cookie its caller alone can give back", async () => {
  const store = new InhibitStore();
  let locked = false;
  const spec = screenSaverInterface({ store, locked: () => locked, lock: () => void (locked = true), idleSeconds: () => 0 });
  const cookie = await spec.methods?.Inhibit?.handler(["Firefox", "video-playing"], call(":1.40"));
  expect(cookie).toBe(1);
  expect(store.getSnapshot()[0]).toMatchObject({ appId: "Firefox", reason: "video-playing", flags: InhibitFlag.idle, via: "screensaver" });
  await spec.methods?.UnInhibit?.handler([cookie], call(":1.41"));
  expect(store.getSnapshot()).toHaveLength(1);
  await spec.methods?.UnInhibit?.handler([cookie], call(":1.40"));
  expect(store.getSnapshot()).toEqual([]);
  expect(await spec.methods?.GetActive?.handler([], call(":1.40"))).toBe(false);
  await spec.methods?.Lock?.handler([], call(":1.40"));
  expect(locked).toBe(true);
});

test("the portal host: holds for anyone, sheets and the Dock only for the portal", async () => {
  const store = new InhibitStore();
  const expected: string[][] = [];
  const spec = portalHostInterface(
    {
      store,
      screenSaver: { locked: () => false, lock: () => {}, idleSeconds: () => 0 },
      expectSheet: (t, p) => expected.push([t, p]) > 0,
      addToDock: () => {},
    },
    async (sender) => sender === ":1.2",
  );
  const id = await spec.methods?.Inhibit?.handler(["org.gnome.Totem", "Playing", 12], call(":1.2"));
  expect(store.blocks(InhibitFlag.suspend)).toBe(true);
  await spec.methods?.Uninhibit?.handler([id], call(":1.2"));
  expect(store.getSnapshot()).toEqual([]);
  expect(await spec.methods?.ExpectSheet?.handler(["dashi-portal:t1", "wayland:abc"], call(":1.2"))).toBe(true);
  await expect(Promise.resolve(spec.methods?.ExpectSheet?.handler(["dashi-portal:t2", "wayland:abc"], call(":1.3")))).rejects.toThrow("only dashi-portal");
  expect(expected).toEqual([["dashi-portal:t1", "wayland:abc"]]);
});
