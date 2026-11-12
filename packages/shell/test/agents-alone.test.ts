/**
 * Work alone (agents/alone/; docs/actions.md, "Working alone"): who
 * may turn it on, that nothing lengthens
 * or widens it, that it ends on time, at the lock and at logout, and the
 * record it keeps.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aloneNotice, recordSummary, recordText } from "../src/agents/alone/record-words.ts";
import { AloneRecords } from "../src/agents/alone/records.ts";
import { coversSite, coversTool } from "../src/agents/alone/rules.ts";
import type { AloneRecord, AloneState } from "../src/agents/alone/types.ts";
import { WorkAlone } from "../src/agents/alone/work-alone.ts";
import { SCOPES, type Scope } from "../src/agents/consent.ts";
import { answeredByPerson, personPressedWindow } from "../src/agents/person.ts";
import { SiteConsent, SiteGrants } from "../src/agents/sites.ts";
import { fakeClockEachTest } from "./support/time.ts";

const clock = fakeClockEachTest();

const EVERY_SCOPE: Scope[] = SCOPES.map((scope) => scope.id);
const _everything = (now: number): AloneState => ({
  on: true,
  started: now,
  ends: now + 60_000,
  scopes: EVERY_SCOPE,
  sites: ["example.com"],
  throughLock: false,
});
const person = (alone = true) => new WorkAlone({ personPressed: async () => alone });
const pick = { scopes: ["see", "screen"], sites: ["example.com"], minutes: 1 };

describe("only the person turns it on", () => {
  test("a press that wasn't the person's is refused, and nothing is on", async () => {
    const alone = person(false);
    expect(await alone.start(pick)).toEqual({ ok: false, why: "Only you can turn this on. Press it yourself, here." });
    expect(alone.getSnapshot()).toEqual({ on: false });
    expect(alone.covers("list_windows", "see")).toBe(false);
  });

  test("not knowing whose press it was is a no", async () => {
    const alone = new WorkAlone({ personPressed: () => Promise.reject(new Error("no compositor")) });
    expect((await alone.start(pick)).ok).toBe(false);
    expect(alone.getSnapshot().on).toBe(false);
  });

  test("the press is asked of the compositor for Settings' own window: an agent's press there since is a no", async () => {
    const windows = async () => [
      { id: 4, appId: "dev.dashi.files" },
      { id: 9, appId: "dev.dashi.settings" },
    ];
    const asked: number[] = [];
    const origin = (answer: { person: number | null; agent: number | null }) => ({
      windows,
      inputOrigin: async ({ window }: { window: number }) => {
        asked.push(window);
        return answer;
      },
    });
    expect(await personPressedWindow(origin({ person: 120, agent: null }), "dev.dashi.settings")).toBe(true);
    expect(asked).toEqual([9]);
    // The agent's pointer or keys pressed there after the person: not theirs.
    expect(await personPressedWindow(origin({ person: 900, agent: 40 }), "dev.dashi.settings")).toBe(false);
    // Only an agent pressed; nobody pressed; the person's press is old.
    expect(await personPressedWindow(origin({ person: null, agent: 40 }), "dev.dashi.settings")).toBe(false);
    expect(await personPressedWindow(origin({ person: null, agent: null }), "dev.dashi.settings")).toBe(false);
    expect(await personPressedWindow(origin({ person: 5_000, agent: null }), "dev.dashi.settings")).toBe(false);
    // No Settings window, or a compositor that fails.
    expect(await personPressedWindow(origin({ person: 120, agent: null }), "dev.dashi.nothing")).toBe(false);
    expect(await personPressedWindow({ windows: () => Promise.reject(new Error("gone")), inputOrigin: async () => ({ person: 1, agent: null }) }, "x")).toBe(
      false,
    );
    expect(answeredByPerson({ person: 100, agent: 100 })).toBe(false);
  });

  test("while it runs, starting again is refused: it can't be made longer or wider", async () => {
    const alone = person();
    await alone.start(pick);
    const before = alone.getSnapshot();
    expect(await alone.start({ scopes: ["see", "screen", "act", "files"], sites: ["example.com", "other.com"], minutes: 480 })).toEqual({
      ok: false,
      why: "It is on. Stop it first to change it.",
    });
    expect(alone.getSnapshot()).toBe(before);
    expect(alone.covers("launch_app", "act")).toBe(false);
    expect(alone.status()).toMatchObject({ on: true, secondsLeft: 60, scopes: ["see", "screen"], sites: ["example.com"] });
  });

  test("what agents are handed has no way to start it", () => {
    // The gate a connection is given (AloneGate) is covers, holds, site, note and status; `status` is a copy.
    const alone = person();
    const status = alone.status();
    status.scopes.push("act");
    status.on = true;
    expect(alone.status()).toEqual({ on: false, secondsLeft: 0, scopes: [], sites: [] });
  });

  test("a time that is no time, or nothing picked, is refused before anyone is asked", async () => {
    let asked = 0;
    const alone = new WorkAlone({
      personPressed: async () => {
        asked++;
        return true;
      },
    });
    for (const minutes of [0, -5, 481, 1.5, Number.NaN, "60", null]) expect((await alone.start({ ...pick, minutes })).ok).toBe(false);
    expect((await alone.start({ scopes: [], sites: ["example.com"], minutes: 5 })).ok).toBe(false);
    expect(asked).toBe(0);
    expect(alone.getSnapshot().on).toBe(false);
  });
});

describe("it ends by itself", () => {
  test("when the time is up, on the clock", async () => {
    const alone = person();
    const ended: AloneRecord[] = [];
    alone.onEnd((record) => ended.push(record));
    await alone.start(pick);
    const started = clock.now();
    expect(alone.covers("list_windows", "see")).toBe(true);
    await clock.advance(59_000);
    expect(alone.status()).toMatchObject({ on: true, secondsLeft: 1 });
    expect(alone.covers("list_windows", "see")).toBe(true);
    await clock.advance(1_000);
    expect(alone.getSnapshot()).toEqual({ on: false });
    expect(alone.covers("list_windows", "see")).toBe(false);
    expect(alone.site("example.com")).toBe(false);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ why: "time", started, ended: started + 60_000 });
  });

  test("a timer that is late (the computer slept) covers nothing past its time", async () => {
    const alone = person();
    await alone.start(pick);
    const { ends } = alone.getSnapshot() as Extract<AloneState, { on: true }>;
    expect(coversTool(alone.getSnapshot(), "list_windows", "see", ends)).toBe(false);
    expect(coversSite(alone.getSnapshot(), "example.com", ends + 1)).toBe(false);
  });

  test("when the screen locks, unless the person chose to keep it", async () => {
    const ends = person();
    await ends.start(pick);
    ends.screenLocked();
    expect(ends.getSnapshot()).toEqual({ on: false });
    expect(ends.records.getSnapshot()[0]?.why).toBe("locked");

    const kept = person();
    await kept.start({ ...pick, throughLock: true });
    kept.screenLocked();
    expect(kept.getSnapshot().on).toBe(true);
    // Its time still runs out.
    await clock.advance(60_000);
    expect(kept.getSnapshot().on).toBe(false);
  });

  test("at logout, with its record kept and nothing said; a new shell starts with it off", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "dashi-alone-")), "alone.json");
    const alone = new WorkAlone({ personPressed: async () => true, records: new AloneRecords(path) });
    const ended: AloneRecord[] = [];
    alone.onEnd((record) => ended.push(record));
    await alone.start(pick);
    alone.close();
    expect(ended).toEqual([]);
    expect(new AloneRecords(path).getSnapshot()[0]?.why).toBe("logout");
    expect(new WorkAlone({ personPressed: async () => true, records: new AloneRecords(path) }).getSnapshot()).toEqual({ on: false });
  });

  test("anyone may stop it, and stopping twice ends it once", async () => {
    const alone = person();
    await alone.start(pick);
    expect(alone.stop()?.why).toBe("stopped");
    expect(alone.stop()).toBeNull();
    expect(clock.pending()).toBe(0);
  });
});

describe("sites", () => {
  test("a picked site and its subdomains ask nothing while it runs; others ask; after it, all ask", async () => {
    const alone = person();
    const asked: string[] = [];
    const consent = new SiteConsent(
      new SiteGrants(null),
      () => "claude",
      async (site) => {
        asked.push(site);
        return "deny";
      },
      new Set(),
      (site) => alone.site(site),
    );
    await alone.start({ scopes: ["web"], sites: ["https://www.example.com/x"], minutes: 1 });
    expect(await consent.allow("example.com")).toBe(true);
    expect(await consent.allow("login.example.com")).toBe(true);
    expect(await consent.allow("other.com")).toBe(false);
    expect(asked).toEqual(["other.com"]);
    alone.stop();
    expect(consent.has("example.com")).toBe(false);
  });

  test("sites count only with Use websites picked", async () => {
    const alone = person();
    await alone.start({ scopes: ["see"], sites: ["example.com"], minutes: 1 });
    expect(alone.site("example.com")).toBe(false);
  });
});

describe("the record", () => {
  test("keeps who called what, on which sites, when, and whether it asked; never more than it says", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "dashi-alone-")), "alone.json");
    const alone = new WorkAlone({ personPressed: async () => true, records: new AloneRecords(path) });
    alone.note({ agent: "claude", tool: "list_windows", sites: [], outcome: "ok", free: false });
    await alone.start({ scopes: ["see", "web"], sites: ["example.com"], minutes: 1 });
    const started = clock.now();
    alone.note({ agent: "claude", tool: "list_windows", sites: [], outcome: "ok", free: true });
    await clock.advance(2_000);
    alone.note({ agent: "claude", tool: "open_url", sites: ["example.com"], outcome: "ok", free: true });
    alone.note({ agent: "codex", tool: "list_notifications", sites: [], outcome: "error", free: false });
    const record = alone.stop();
    expect(record).toMatchObject({ why: "stopped", scopes: ["see", "web"], sites: ["example.com"], more: 0 });
    expect(record?.calls.map((call) => [call.time - started, call.agent, call.tool, call.free])).toEqual([
      [0, "claude", "list_windows", true],
      [2_000, "claude", "open_url", true],
      [2_000, "codex", "list_notifications", false],
    ]);
    if (!record) throw new Error("no record");
    expect(recordSummary(record)).toBe("3 actions on 1 site, 2 without asking");
    expect(aloneNotice(record)).toMatchObject({ summary: "Agents ask again", body: "You stopped it. 3 actions on 1 site, 2 without asking in 0:02." });
    const text = recordText(record, "en-US");
    expect(text).toContain("Without asking: See windows and apps, Use websites.");
    expect(text).toContain("claude  open_url · example.com · without asking");
    expect(text).toContain("codex  list_notifications · failed");
    // Kept in the file, read back, newest first; junk in the file is dropped, not trusted.
    expect(new AloneRecords(path).getSnapshot()).toEqual([record]);
    const kept = JSON.parse(readFileSync(path, "utf8"));
    kept.records.push({ started: "yesterday" });
    kept.records[0].scopes.push("not-a-scope");
    writeFileSync(path, JSON.stringify(kept));
    expect(new AloneRecords(path).getSnapshot()).toEqual([record]);
  });

  test("ten times are kept", () => {
    const records = new AloneRecords(null);
    for (let n = 0; n < 12; n++) records.add({ started: n, ended: n + 1, why: "time", scopes: [], sites: [], calls: [], more: 0 });
    expect(records.getSnapshot().map((record) => record.started)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });
});
