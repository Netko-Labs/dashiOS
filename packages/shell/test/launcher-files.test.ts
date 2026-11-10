import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeSync } from "node:fs";
import { closeFd, FdService, pipePair, type Variant } from "../src/dbus/index.ts";
import { FileSearch } from "../src/file-search.ts";
import { BUDGET, LatestOnly, SUPERSEDED } from "../src/launcher/budget.ts";
import {
  CANDIDATES,
  type DatedHit,
  findFiles,
  hitOf,
  LOCAL_SEARCH,
  LocalSearchEndpoint,
  nameTier,
  parseCursor,
  rankFiles,
  readToEnd,
} from "../src/local-search.ts";
import { type PrivateBus, startPrivateBus } from "./private-bus.ts";
import { flush } from "./support/time.ts";

/** Rows in TinySPARQL's cursor format, as the endpoint writes them (host byte order; null is unbound). */
function encodeCursor(rows: readonly (readonly (string | null)[])[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const row of rows) {
    const values = row.map((value) => encoder.encode(value ?? ""));
    const header = new DataView(new ArrayBuffer(4 + row.length * 8));
    header.setInt32(0, row.length, true);
    let end = -1;
    for (const [i, value] of values.entries()) {
      header.setInt32(4 + i * 4, row[i] === null ? 0 : 1, true);
      end += value.length + 1;
      header.setInt32(4 + (row.length + i) * 4, end, true);
    }
    parts.push(new Uint8Array(header.buffer));
    for (const value of values) parts.push(value, new Uint8Array([0]));
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const HOME = "/home/alexk";
const row = (name: string, modified: string, mime: string | null = "text/plain"): (string | null)[] => [`file://${HOME}/Documents/${name}`, mime, modified];

describe("the cursor", () => {
  test("rows come back as written, unbound values as null", () => {
    const rows = [row("tea.md", "2026-11-01T10:00:00Z"), row("tea notes.txt", "2026-11-02T10:00:00Z", null)];
    expect(parseCursor(encodeCursor(rows), 3, true)).toEqual(rows);
    expect(parseCursor(new Uint8Array(0), 3, true)).toEqual([]);
  });

  test("anything malformed is null: the wrong column count, a cut row, a missing NUL", () => {
    const bytes = encodeCursor([row("tea.md", "2026-11-01T10:00:00Z")]);
    expect(parseCursor(bytes, 2, true)).toBeNull();
    expect(parseCursor(bytes.subarray(0, bytes.length - 3), 3, true)).toBeNull();
    const broken = bytes.slice();
    broken[broken.length - 1] = 65;
    expect(parseCursor(broken, 3, true)).toBeNull();
  });

  test("a pipe is read to its end", async () => {
    const pipe = pipePair();
    writeSync(pipe.write, "hello ");
    writeSync(pipe.write, "files");
    closeFd(pipe.write);
    expect(new TextDecoder().decode((await readToEnd(pipe.read)) ?? new Uint8Array())).toBe("hello files");
  });
});

describe("ranking files", () => {
  const dated = (name: string, modified: number): DatedHit => ({ url: `file:///${name}`, path: `/${name}`, name, folder: "~", mime: null, modified });

  test("the whole name, then its start, then a word's start, then anywhere", () => {
    expect(nameTier("tea.md", "tea")).toBe(0);
    expect(nameTier("Tea", "tea")).toBe(0);
    expect(nameTier("teapot.png", "tea")).toBe(1);
    expect(nameTier("green-tea.md", "tea")).toBe(2);
    expect(nameTier("my tea notes", "tea")).toBe(2);
    expect(nameTier("instead.txt", "tea")).toBe(3);
    expect(nameTier("a+b.txt", "+b")).toBe(3);
  });

  test("by name first, the newest first among equals", () => {
    const hits = [
      dated("instead.txt", 9),
      dated("green-tea.md", 5),
      dated("teapot.png", 1),
      dated("tea.md", 0),
      dated("tea-old.md", 2),
      dated("tea-new.md", 8),
    ];
    expect(rankFiles(hits, "tea").map((hit) => hit.name)).toEqual(["tea.md", "tea-new.md", "tea-old.md", "teapot.png", "green-tea.md", "instead.txt"]);
  });

  test("a row is a local file with its folder under ~; anything else is skipped", () => {
    expect(hitOf(row("a%20b.md", "2026-11-01T10:00:00Z"), HOME)).toMatchObject({
      name: "a b.md",
      folder: "~/Documents",
      mime: "text/plain",
      modified: Date.parse("2026-11-01T10:00:00Z"),
    });
    expect(hitOf(["https://example.com/x", null, null], HOME)).toBeNull();
    expect(hitOf([`file://${HOME}/x`, "not a mime", "never"], HOME)).toMatchObject({ mime: null, modified: 0 });
  });

  test("LocalSearch is asked with the text bound, never spliced; more than fit are ranked, the best kept", async () => {
    const asked: { sparql: string; args: Readonly<Record<string, string>> }[] = [];
    const rows = [
      row("instead.txt", "2026-11-05T10:00:00Z"),
      row("tea.md", "2026-10-01T10:00:00Z"),
      row("teapot.png", "2026-11-04T10:00:00Z"),
      row("x-tea", "2026-11-03T10:00:00Z"),
    ];
    const hits = await findFiles(
      async (sparql, args) => {
        asked.push({ sparql, args });
        return rows;
      },
      'tea" } DROP',
      HOME,
      3,
    );
    expect(asked[0]?.args).toEqual({ q: 'tea" } DROP' });
    expect(asked[0]?.sparql).toContain("~q");
    expect(asked[0]?.sparql).not.toContain("DROP");
    expect(asked[0]?.sparql).toContain(`LIMIT ${CANDIDATES}`);
    expect(CANDIDATES).toBeGreaterThan(4);
    expect(hits?.map((hit) => hit.name)).toHaveLength(3);
    const ranked = await findFiles(async () => rows, "tea", HOME, 3);
    expect(ranked?.map((hit) => hit.name)).toEqual(["tea.md", "teapot.png", "x-tea"]);
    expect(await findFiles(async () => null, "tea", HOME, 3)).toBeNull();
  });
});

describe("one question at a time", () => {
  test("a newer ask replaces one still waiting; the one running finishes", async () => {
    const ran: string[] = [];
    const releases: (() => void)[] = [];
    const latest = new LatestOnly<string, string>(
      (query) =>
        new Promise((resolve) => {
          ran.push(query);
          releases.push(() => resolve(`hits for ${query}`));
        }),
    );
    const te = latest.ask("te");
    const ter = latest.ask("ter");
    const term = latest.ask("term");
    expect(await ter).toBe(SUPERSEDED);
    releases.shift()?.();
    expect(await te).toBe("hits for te");
    await flush();
    releases.shift()?.();
    expect(await term).toBe("hits for term");
    expect(ran).toEqual(["te", "term"]);
  });

  test("FileSearch: a replaced ask is empty, and a short query asks nothing", async () => {
    const asked: string[] = [];
    let release: () => void = () => {};
    const search = new FileSearch({
      installed: true,
      ask: (query) => {
        asked.push(query);
        return new Promise((resolve) => {
          release = () => resolve([]);
        });
      },
    });
    expect(await search.find("t")).toEqual([]);
    const first = search.find("te");
    const second = search.find("ter");
    const third = search.find("term");
    expect(await second).toEqual([]);
    release();
    await first;
    await flush();
    release();
    await third;
    expect(asked).toEqual(["te", "term"]);
  });
});

describe("LocalSearch over D-Bus", () => {
  let bus: PrivateBus | null = null;
  beforeAll(async () => {
    bus = await startPrivateBus("dashi-localsearch");
  });
  afterAll(() => bus?.stop());

  test("one connection asks Query with a pipe, and the cursor comes back through it", async () => {
    if (!bus) return;
    const address = bus.address;
    const endpoint = await FdService.connect({ address });
    const seen: { sparql: string; q: unknown }[] = [];
    endpoint.export(LOCAL_SEARCH.path, [
      {
        name: LOCAL_SEARCH.interface,
        methods: {
          Query: {
            in: "sha{sv}",
            out: "as",
            handler: ([sparql, index, args], call) => {
              const q = (args as Map<string, Variant>).get("q")?.value;
              seen.push({ sparql: sparql as string, q });
              const fd = call.fds?.[index as number];
              if (fd !== undefined) writeSync(fd, encodeCursor([row(`${String(q)}.md`, "2026-11-01T10:00:00Z")]));
              return ["url", "mime", "modified"];
            },
          },
        },
      },
    ]);
    await endpoint.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus",
      member: "RequestName",
      signature: "su",
      body: [LOCAL_SEARCH.name, 4],
    });

    let connections = 0;
    const local = new LocalSearchEndpoint(() => {
      connections += 1;
      return FdService.connect({ address });
    });
    const first = await findFiles(local.ask, "tea", HOME, 3);
    const second = await findFiles(local.ask, "coffee", HOME, 3);
    expect(first?.map((hit) => hit.name)).toEqual(["tea.md"]);
    expect(second?.map((hit) => hit.name)).toEqual(["coffee.md"]);
    expect(seen.map((each) => each.q)).toEqual(["tea", "coffee"]);
    expect(connections).toBe(1);
    local.close();
    endpoint.close();
  });

  test("an endpoint that isn't there is null, not an error", async () => {
    if (!bus) return;
    const address = bus.address;
    const local = new LocalSearchEndpoint(() => FdService.connect({ address }));
    expect(await local.ask("SELECT 1 {}", {})).toBeNull();
    local.close();
    const unreachable = new LocalSearchEndpoint(() => Promise.reject(new Error("no bus")));
    expect(await unreachable.ask("SELECT 1 {}", {})).toBeNull();
  });

  test("the budgets the page sets", () => {
    expect(BUDGET).toEqual({ openMs: 50, keystrokeMs: 16, instantMs: 2, filesMs: 80, slowMs: 80, giveUpMs: 2000, misses: 3 });
  });
});
