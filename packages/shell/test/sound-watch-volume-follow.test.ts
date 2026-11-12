/**
 * VolumeFollow: a level set here holds against the older words PipeWire reports, and the newest word
 * since shows once the hold has run out.
 */

import { describe, expect, test } from "bun:test";
import { VolumeFollow } from "../src/system/volume-follow.ts";
import { fakeClockEachTest } from "./support/time.ts";

const clock = fakeClockEachTest();

describe("VolumeFollow", () => {
  test("holds what was set against older words; then the newest word since", () => {
    let now = 0;
    const shown: Array<number | null> = [];
    const follow = new VolumeFollow(
      (volume) => shown.push(volume?.level ?? null),
      1000,
      () => now,
    );
    follow.heard({ level: 0.4, muted: false });
    follow.set({ level: 0.8, muted: false });
    follow.heard({ level: 0.6, muted: false });
    follow.heard({ level: 0.8, muted: false });
    now = 1001;
    follow.heard({ level: 0.3, muted: false });
    expect(shown).toEqual([0.4, 0.8, 0.3]);
    follow.stop();
  });

  test("a word after the hold is the last word: an older one heard during it never comes after", async () => {
    let now = 0;
    const shown: Array<number | null> = [];
    const follow = new VolumeFollow(
      (volume) => shown.push(volume?.level ?? null),
      1000,
      () => now,
    );
    follow.set({ level: 0.8, muted: false });
    follow.heard({ level: 0.6, muted: false });
    // The hold is over by the clock, and its timer has not run yet (it runs late under load).
    now = 1001;
    follow.heard({ level: 0.3, muted: false });
    await clock.advance(2000);
    expect(shown).toEqual([0.3]);
    follow.stop();
  });

  test("nothing heard since the set: what was set stays", async () => {
    const shown: Array<number | null> = [];
    const follow = new VolumeFollow((volume) => shown.push(volume?.level ?? null), 10);
    follow.heard({ level: 0.4, muted: false });
    follow.set({ level: 0.8, muted: false });
    await clock.advance(30);
    expect(shown).toEqual([0.4]);
    follow.set({ level: 0.9, muted: false });
    follow.heard({ level: 0.5, muted: false });
    await clock.advance(30);
    expect(shown).toEqual([0.4, 0.5]);
  });
});
