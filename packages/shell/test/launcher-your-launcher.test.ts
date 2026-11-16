/**
 * "Your launcher" (store-v2 slice 3): quicklinks with {Query}, fallbacks
 * when nothing matches, window thirds and quarters by name, and the
 * clipboard history's kind filter.
 */

import { describe, expect, test } from "bun:test";
import type { ActionDef, Outcome } from "../src/actions/index.ts";
import { arrangeActions, NAMED_TILES } from "../src/actions/lib/sources/windows.ts";
import type { ClipEntry } from "../src/clipboard/history.ts";
import { historySections, ofKind } from "../src/clipboard/lib/rows.ts";
import { tileGlyph } from "../src/launcher/lib/command-glyphs.ts";
import { buildSections } from "../src/launcher/lib/rows.ts";
import { DEFAULT_FALLBACKS, fillQuery, isQuicklinkList, type Quicklink, quicklinkId } from "../src/launcher/quicklink-list.ts";
import { QuicklinkSource } from "../src/launcher/quicklinks.ts";
import { verbsFor } from "../src/launcher/verbs.ts";
import { tileFrame } from "../src/layout.ts";

function store(initial: Quicklink[]) {
  let list = initial;
  return {
    list: () => list,
    set: (next: readonly Quicklink[]) => {
      list = [...next];
    },
    subscribe: () => () => {},
  };
}

async function run(action: ActionDef | undefined, args: Record<string, unknown>): Promise<Outcome> {
  if (!action) throw new Error("no such action");
  const checked = action.check(args);
  if (!checked.ok) return { ok: false, error: checked.error };
  return checked.run({ window: null });
}

describe("quicklinks", () => {
  test("the words go where {Query} is, encoded", () => {
    expect(fillQuery("https://github.com/search?q={Query}", "launcher api")).toBe("https://github.com/search?q=launcher%20api");
    expect(quicklinkId("Search GitHub", ["search-github"])).toBe("search-github-2");
  });

  test("each is an action that asks for its words, then opens the address with them", async () => {
    const opened: string[] = [];
    const links = store([{ id: "github", name: "Search GitHub", url: "https://github.com/search?q={Query}" }]);
    const source = new QuicklinkSource({ store: links, open: async (target) => (opened.push(target), { ok: true, text: "" }) });
    const github = source.actions().find((action) => action.address === "dashi://quicklink/github");
    expect(github?.required).toEqual(["query"]);
    expect((await run(github, {})).ok).toBe(false);
    await run(github, { query: "launcher api" });
    expect(opened).toEqual(["https://github.com/search?q=launcher%20api"]);
  });

  test("New Quicklink keeps one; the library adds a made one; settings refuse a bad list", async () => {
    const links = store([]);
    const source = new QuicklinkSource({ store: links, open: async () => ({ ok: true, text: "" }) });
    const create = source.actions().find((action) => action.address === "dashi://quicklink/new");
    expect(await run(create, { name: "Dashi issues", url: "github.com/Netko-Labs/dashiOS/issues?q={Query}" })).toEqual({
      ok: true,
      text: "Dashi issues is a quicklink now",
    });
    expect(links.list()).toEqual([{ id: "dashi-issues", name: "Dashi issues", url: "https://github.com/Netko-Labs/dashiOS/issues?q={Query}" }]);
    expect(isQuicklinkList(links.list())).toBe(true);
    expect(isQuicklinkList([{ id: "x", name: "Evil", url: "javascript:alert(1)" }])).toBe(false);
  });
});

describe("fallbacks", () => {
  const web: ActionDef = {
    address: DEFAULT_FALLBACKS[0] ?? "",
    title: "Search the Web",
    description: "",
    keywords: {},
    kind: "open",
    properties: { query: { type: "string" } },
    required: ["query"],
    scope: null,
    readOnly: false,
    destructive: false,
    who: "person",
    source: "quicklinks",
    check: () => ({ ok: false, error: "" }),
  };

  test("when nothing matches, the person's fallbacks come first, with the words", () => {
    const sections = buildSections({
      query: "flights to bogota",
      entries: [],
      recent: [],
      files: { kind: "none" },
      icons: { calculator: "", files: "", software: "" },
      fallbacks: [web],
    });
    const nothing = sections.find((section) => section.id === "nothing");
    expect(nothing?.rows[0]).toMatchObject({ id: "fallback:dashi://quicklink/web", title: "Search the Web", detail: "“flights to bogota”" });
    expect(nothing?.rows[0]?.action).toEqual({ kind: "run-args", action: web, args: { query: "flights to bogota" } });
  });

  test("❖K on a quicklink offers Use When Nothing Matches, and takes it back", () => {
    const row = {
      id: "x",
      title: "Search the Web",
      kind: "",
      icon: { none: true as const },
      action: { kind: "type" as const, query: "" },
      item: { id: web.address, kind: "command" as const, names: [], action: web },
    };
    expect(verbsFor(row, { windows: [], fallbacks: [] }).map((verb) => verb.title)).toContain("Use When Nothing Matches");
    expect(verbsFor(row, { windows: [], fallbacks: [web.address] }).map((verb) => verb.title)).toContain("Don't Use When Nothing Matches");
  });
});

describe("window thirds and quarters", () => {
  const usable = { x: 0, y: 30, width: 1206, height: 700 };

  test("three thirds fill the width with the same gap between them; two thirds are two of them and the gap", () => {
    const [left, center, right] = (["left-third", "center-third", "right-third"] as const).map((tile) => tileFrame(tile, usable));
    expect(left?.x).toBe(6);
    expect((center?.x ?? 0) - ((left?.x ?? 0) + (left?.width ?? 0))).toBe(6);
    expect((right?.x ?? 0) + (right?.width ?? 0)).toBe(1200);
    const two = tileFrame("left-two-thirds", usable);
    expect(two.x + two.width).toBe((center?.x ?? 0) + (center?.width ?? 0));
  });

  test("every named tile is an action with its own glyph", () => {
    const actions = arrangeActions({
      windows: async () => [],
      appName: () => "",
      focus: async () => {},
      arrow: async () => {},
      tile: async () => {},
      fullscreen: async () => {},
      keymap: { rules: [] } as never,
    });
    for (const each of NAMED_TILES) {
      expect(actions.some((action) => action.address === `dashi://window/tile/${each.tile}` && action.title === each.title)).toBe(true);
      expect(tileGlyph(each.tile)).toContain("<rect");
    }
  });
});

describe("the clipboard's kind filter", () => {
  const entry = (id: string, kind: ClipEntry["kind"], text?: string): ClipEntry =>
    ({ id, kind, mime: "text/plain", text, size: 1, app: "Notes", copiedAt: 0, pinned: false }) as unknown as ClipEntry;
  const entries = [
    entry("a", "text", "git push"),
    entry("b", "text", "https://developers.raycast.com/api"),
    entry("c", "image"),
    entry("d", "files", "/home/alexk/trip.pdf"),
  ];

  test("a link is text that is one address; each kind shows only its own", () => {
    expect(entries.filter((each) => ofKind(each, "links")).map((each) => each.id)).toEqual(["b"]);
    expect(entries.filter((each) => ofKind(each, "text")).map((each) => each.id)).toEqual(["a"]);
    const [section] = historySections({ entries, skipped: [] } as never, "", { now: 0, enabled: true, imagePath: () => null, kind: "links" });
    expect(section?.title).toBe("4 copies · Links only");
    expect(section?.rows.map((row) => row.id)).toEqual(["clip:b"]);
  });
});
