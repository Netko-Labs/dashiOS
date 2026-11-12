/**
 * Work alone's rules (agents/alone/rules.ts; docs/actions.md, "Working
 * alone"): what it can never cover, whatever is picked, and what the picks
 * start from.
 */

import { describe, expect, test } from "bun:test";
import { ASKS_EVERY_TIME } from "../src/actions/tools.ts";
import {
  ALONE_SCOPES,
  aloneDefaults,
  cleanConfig,
  coversTool,
  customMinutes,
  minutesWords,
  NEVER_ALONE_SCOPES,
  NEVER_ALONE_TOOLS,
} from "../src/agents/alone/rules.ts";
import type { AloneState } from "../src/agents/alone/types.ts";
import { WorkAlone } from "../src/agents/alone/work-alone.ts";
import { SCOPES, type Scope } from "../src/agents/consent.ts";
import { TOOLS } from "../src/agents/tools/registry.ts";
import { SETTINGS_ROWS } from "../src/settings-app/registry/rows.ts";
import { fakeClockEachTest } from "./support/time.ts";

const clock = fakeClockEachTest();

const EVERY_SCOPE: Scope[] = SCOPES.map((scope) => scope.id);
const everything = (now: number): AloneState => ({
  on: true,
  started: now,
  ends: now + 60_000,
  scopes: EVERY_SCOPE,
  sites: ["example.com"],
  throughLock: false,
});
const person = (alone = true) => new WorkAlone({ personPressed: async () => alone });
const _pick = { scopes: ["see", "screen"], sites: ["example.com"], minutes: 1 };

describe("never allowed, whatever is picked", () => {
  test("payments, sign-ins and the clipboard history are not kinds a person can pick", () => {
    expect([...NEVER_ALONE_SCOPES].sort()).toEqual(["clipboard", "pay", "signin"]);
    for (const scope of NEVER_ALONE_SCOPES) expect(ALONE_SCOPES).not.toContain(scope);
    const clean = cleanConfig({ scopes: EVERY_SCOPE, sites: [], minutes: 60 });
    expect("problem" in clean).toBe(false);
    if (!("problem" in clean)) for (const scope of NEVER_ALONE_SCOPES) expect(clean.scopes).not.toContain(scope);
    // Picking only those leaves nothing to allow.
    expect(cleanConfig({ scopes: ["pay", "signin", "clipboard"], sites: [], minutes: 60 })).toEqual({ problem: "Pick at least one thing agents may do." });
  });

  test("with every kind forced on, the tools that pay, use a secret, or ask every time still aren't covered", () => {
    const now = clock.now();
    const state = everything(now);
    const never = [
      "pay",
      "sign_in",
      "fill_code",
      "list_logins",
      "read_clipboard_history",
      "force_quit_app",
      "trash_file",
      "request_software_install",
      "request_software_update",
    ];
    for (const name of never) {
      const tool = TOOLS.find((each) => each.name === name);
      expect(tool).toBeDefined();
      if (tool) expect(coversTool(state, tool.name, tool.scope, now)).toBe(false);
    }
    // Every tool that asks every time, and every tool of a kind it never covers, by the registry itself.
    for (const tool of TOOLS) {
      if (ASKS_EVERY_TIME.has(tool.name) || NEVER_ALONE_SCOPES.has(tool.scope)) {
        expect(NEVER_ALONE_TOOLS.has(tool.name) || NEVER_ALONE_SCOPES.has(tool.scope)).toBe(true);
        expect(coversTool(state, tool.name, tool.scope, now)).toBe(false);
      }
    }
    // What is left is covered.
    expect(coversTool(state, "list_windows", "see", now)).toBe(true);
  });

  test("a running one started with those kinds anyway (a bug, a hand) never holds them", async () => {
    const alone = person();
    expect(await alone.start({ scopes: EVERY_SCOPE, sites: [], minutes: 5 })).toEqual({ ok: true });
    for (const scope of NEVER_ALONE_SCOPES) expect(alone.holds(scope)).toBe(false);
    expect(alone.covers("pay", "pay")).toBe(false);
    expect(alone.covers("force_quit_app", "act")).toBe(false);
    expect(alone.covers("trash_file", "files")).toBe(false);
    expect(alone.status().scopes).not.toContain("pay");
  });

  test("no row of Settings › Agents, and nothing that holds consent, is an agent's to set", () => {
    const consent = ["agents", "privacy", "passwords", "lock-screen", "users"];
    for (const row of SETTINGS_ROWS) {
      if (consent.some((pane) => row.id.startsWith(`${pane}/`))) expect({ id: row.id, agent: row.agent }).toEqual({ id: row.id, agent: undefined });
    }
    // Its own rows are not values a link or the launcher can set: they only open Settings.
    const own = SETTINGS_ROWS.filter((row) => row.id.startsWith("agents/work-alone"));
    expect(own.length).toBe(6);
    for (const row of own) expect(row.value).toBeUndefined();
  });

  test("the one tool about it is read-only and takes nothing", () => {
    const about = TOOLS.filter((tool) => /alone/.test(tool.name));
    expect(about.map((tool) => tool.name)).toEqual(["get_work_alone"]);
    expect(about[0]).toMatchObject({ readOnly: true, destructive: false, properties: {} });
  });
});

describe("the picks", () => {
  test("start from what was already allowed, never from what can't be", () => {
    const first = aloneDefaults([{ scopes: ["see", "screen", "signin"] }, { scopes: ["web", "see"] }], ["bodytech.com.co", "example.com", "example.com"]);
    expect(first).toEqual({ scopes: ["see", "screen", "web"], sites: ["bodytech.com.co", "example.com"], minutes: 60, throughLock: false });
    expect(aloneDefaults([], [])).toMatchObject({ scopes: [], sites: [] });
  });

  test("a custom time is whole minutes from 1 to 480", () => {
    expect(customMinutes(" 45 ")).toBe(45);
    expect(customMinutes("1")).toBe(1);
    expect(customMinutes("480")).toBe(480);
    for (const bad of ["", "0", "481", "1.5", "-3", "ten", "1e2"]) expect(customMinutes(bad)).toBeNull();
    expect([15, 60, 240, 90, 1].map(minutesWords)).toEqual(["15 minutes", "1 hour", "4 hours", "1 hour 30 minutes", "1 minute"]);
  });
});
