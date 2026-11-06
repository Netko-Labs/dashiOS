/**
 * Privacy & Security's data: the agents' kept answers with their dates, the
 * portal's permission store read into grants, the dates the shell writes
 * down for them, and the words the pane shows.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GrantChange, Grants, parseGrants } from "../src/agents/consent.ts";
import type { CallSpec } from "../src/dbus/index.ts";
import { PermissionStore } from "../src/privacy/permission-store.ts";
import { byApp, grantKey, grantsOf, PORTAL_TABLES, parsePermissions } from "../src/privacy/portal-grants.ts";
import { parseSeen, reconcile, SeenTimes } from "../src/privacy/seen.ts";
import { PrivacyStore } from "../src/privacy/store.ts";
import { agentPermissions, appTitle, grantDetail, lastUsedWords, programTitle, sinceWords } from "../src/settings-app/privacy-words.ts";

const dir = mkdtempSync(join(tmpdir(), "dashi-privacy-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the agents' kept answers", () => {
  test("version 1's lists read without dates; version 2 keeps a date per scope; pay and the clipboard are never kept", () => {
    const old = parseGrants({ agents: { "/usr/bin/claude": ["see", "pay", "act"] } });
    expect([...(old.get("/usr/bin/claude") ?? [])]).toEqual([
      ["see", null],
      ["act", null],
    ]);
    const now = parseGrants({ version: 2, agents: { "ssh:alexk": { screen: 1_760_000_000, clipboard: 5, nope: 3, see: -1 } } });
    expect([...(now.get("ssh:alexk") ?? [])]).toEqual([
      ["screen", 1_760_000_000],
      ["see", null],
    ]);
    expect(parseGrants("nonsense").size).toBe(0);
  });

  test("a scope kept again keeps its date, a new one is dated now, and one is taken back alone", () => {
    const path = join(dir, "grants.json");
    const grants = new Grants(path);
    const changes: GrantChange[] = [];
    grants.onChange((change) => void changes.push(change));
    grants.set("ssh:alexk", new Set(["see"]), 100);
    grants.set("ssh:alexk", new Set(["see", "act"]), 200);
    expect(grants.entries()).toEqual([{ key: "ssh:alexk", scopes: ["see", "act"], since: { see: 100, act: 200 } }]);
    expect(grants.revoke("ssh:alexk", "act")).toBe(true);
    expect(grants.revoke("ssh:alexk", "act")).toBe(false);
    expect(changes.at(-1)).toEqual({ key: "ssh:alexk", removed: false, revoked: ["act"] });
    expect([...grants.get("ssh:alexk")]).toEqual(["see"]);
    // Saved as version 2, and read back the same.
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 2, agents: { "ssh:alexk": { see: 100 } } });
    expect(new Grants(path).entries()).toEqual(grants.entries());
    // The last scope gone, the agent is gone.
    grants.revoke("ssh:alexk", "see");
    expect(grants.entries()).toEqual([]);
  });

  test("listed by name, riskiest first, with since when", () => {
    const listed = agentPermissions(
      [
        { key: "ssh:zed", scopes: ["notifications", "signin", "act"], since: { signin: 1_760_000_000 } },
        { key: "/usr/bin/claude", scopes: ["see"], since: {} },
        { key: "ssh:none", scopes: [], since: {} },
      ],
      "/home/alexk",
    );
    expect(listed.map((agent) => agent.title)).toEqual(["claude", "zed"]);
    expect(listed[1]?.scopes.map((scope) => scope.scope)).toEqual(["signin", "act", "notifications"]);
    expect(listed[1]?.scopes[0]).toEqual({ scope: "signin", label: "Sign in for you", since: 1_760_000_000 });
  });
});

describe("the portal's permission store", () => {
  const spec = (table: string) => {
    const found = PORTAL_TABLES.find((each) => each.table === table);
    if (!found) throw new Error(table);
    return found;
  };

  test("an entry is read into one grant per app that was told yes", () => {
    const permissions = parsePermissions(
      new Map<unknown, unknown>([
        ["org.mozilla.firefox", ["yes"]],
        ["com.example.Spy", ["no"]],
        [42, ["yes"]],
        ["org.gnome.Maps", "yes"],
      ]),
    );
    expect([...permissions.keys()]).toEqual(["org.mozilla.firefox", "com.example.Spy"]);
    expect(grantsOf(spec("devices"), "camera", permissions)).toEqual([
      { table: "devices", id: "camera", app: "org.mozilla.firefox", what: "Use the camera", screen: false, lastUsed: null },
    ]);
    // Location keeps its accuracy and when it was last used; NONE is a no.
    const location = parsePermissions(
      new Map([
        ["org.gnome.Maps", ["EXACT", "1760000000"]],
        ["org.example.Weather", ["NONE", "0"]],
      ]),
    );
    expect(grantsOf(spec("location"), "location", location)).toEqual([
      { table: "location", id: "location", app: "org.gnome.Maps", what: "See your location", screen: false, lastUsed: 1_760_000_000 },
    ]);
    // A share is one entry per restore token, and screen sharing's.
    expect(grantsOf(spec("screencast"), "token-1", parsePermissions(new Map([["com.obsproject.Studio", ["yes"]]])))[0]).toMatchObject({ screen: true });
    // An entry the table doesn't know means nothing.
    expect(grantsOf(spec("devices"), "printer", permissions)).toEqual([]);
  });

  test("grouped by app, by the app's name", () => {
    const a = { app: "org.mozilla.firefox", what: "a" };
    const b = { app: "", what: "b" };
    const c = { app: "org.mozilla.firefox", what: "c" };
    expect(byApp([a, b, c], (app) => appTitle(app, (id) => (id === "org.mozilla.firefox" ? { name: "Firefox" } : undefined)))).toEqual([
      { app: "", name: "Apps outside Flatpak", grants: [b] },
      { app: "org.mozilla.firefox", name: "Firefox", grants: [a, c] },
    ]);
  });

  test("read over the bus: every table, a missing one is nothing, and taking one back deletes that app's answer", async () => {
    const calls: CallSpec[] = [];
    const bus = {
      call: async (spec: CallSpec): Promise<unknown[]> => {
        calls.push(spec);
        const [table, id] = (spec.body ?? []) as string[];
        if (spec.member === "Ping") return [];
        if (spec.member === "List") return table === "screencast" ? [["token-1"]] : [[]];
        if (spec.member === "Lookup" && table === "devices" && id === "camera") return [new Map([["org.mozilla.firefox", ["yes"]]]), null];
        if (spec.member === "Lookup" && table === "screencast") return [new Map([["com.obsproject.Studio", ["yes"]]]), null];
        if (spec.member === "DeletePermission") throw new Error("org.freedesktop.DBus.Error.UnknownMethod");
        if (spec.member === "SetPermission") return [];
        throw new Error("org.freedesktop.portal.Error.NotFound");
      },
      subscribe: async () => async () => {},
    };
    const store = new PermissionStore(async () => bus);
    const grants = await store.list();
    expect(grants.map(grantKey)).toEqual([
      grantKey({ table: "devices", id: "camera", app: "org.mozilla.firefox" }),
      grantKey({ table: "screencast", id: "token-1", app: "com.obsproject.Studio" }),
    ]);
    await store.revoke({ table: "devices", id: "camera", app: "org.mozilla.firefox" });
    // A store before version 2 has no DeletePermission: an empty answer instead.
    expect(calls.slice(-2).map((call) => [call.member, call.body])).toEqual([
      ["DeletePermission", ["devices", "camera", "org.mozilla.firefox"]],
      ["SetPermission", ["devices", false, "camera", "org.mozilla.firefox", []]],
    ]);
  });

  test("no store on the bus: unavailable, not empty", async () => {
    const store = new PrivacyStore(
      {
        list: async () => {
          throw new Error("org.freedesktop.DBus.Error.ServiceUnknown");
        },
        revoke: async () => {},
        watch: async () => () => {},
      },
      new SeenTimes(null),
    );
    await store.refresh();
    expect(store.getSnapshot()).toEqual({ state: "unavailable" });
  });
});

describe("since when", () => {
  test("the first look dates nothing; a grant seen later is dated then; a grant gone is forgotten", () => {
    expect([...reconcile(new Map(), ["a", "b"], 500, true)]).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
    expect([
      ...reconcile(
        new Map([
          ["a", 0],
          ["b", 0],
        ]),
        ["a", "c"],
        700,
        false,
      ),
    ]).toEqual([
      ["a", 0],
      ["c", 700],
    ]);
    expect([...parseSeen('{"seen":{"a":3,"b":-1,"c":1.5,"d":"x"}}')]).toEqual([["a", 3]]);
    expect(parseSeen("nonsense").size).toBe(0);
  });

  test("kept in a file, and a store's grants carry their dates", async () => {
    const path = join(dir, "privacy", "seen.json");
    const keys = [grantKey({ table: "devices", id: "camera", app: "org.mozilla.firefox" })];
    const first = new SeenTimes(path);
    first.update(keys, 100);
    expect(first.since(keys[0] ?? "")).toBeNull();
    expect(existsSync(path)).toBe(true);
    let listed = [{ table: "devices", id: "camera", app: "org.mozilla.firefox", what: "Use the camera", screen: false, lastUsed: null }];
    const store = new PrivacyStore({ list: async () => listed, revoke: async () => {}, watch: async () => () => {} }, new SeenTimes(path));
    listed = [...listed, { table: "background", id: "background", app: "org.mozilla.firefox", what: "Run in the background", screen: false, lastUsed: null }];
    await store.refresh();
    const snapshot = store.getSnapshot();
    if (snapshot.state !== "ready") throw new Error(snapshot.state);
    expect(snapshot.grants.map((grant) => grant.since === null)).toEqual([true, false]);
    writeFileSync(path, "{}");
    expect(new SeenTimes(path).since(keys[0] ?? "")).toBeNull();
  });

  test("said in the pane's words", () => {
    const now = new Date(2026, 10, 6);
    expect(sinceWords(Math.floor(new Date(2026, 10, 3).getTime() / 1000), now)).toBe("Since Nov 3");
    expect(sinceWords(Math.floor(new Date(2025, 0, 9).getTime() / 1000), now)).toBe("Since Jan 9, 2025");
    expect(sinceWords(null, now)).toBeUndefined();
    expect(lastUsedWords(Math.floor(new Date(2026, 10, 3).getTime() / 1000), now)).toBe("Last used Nov 3");
    expect(grantDetail([undefined, "Last used Nov 3"])).toBe("Last used Nov 3");
    expect(grantDetail([undefined])).toBeUndefined();
    expect(programTitle("/usr/bin/grim")).toBe("grim");
  });
});
