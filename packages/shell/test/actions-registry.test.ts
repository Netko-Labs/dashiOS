import { describe, expect, test } from "bun:test";
import { argsFromQuery, formatAddress, parseAddress, slug, withArgs } from "../src/actions/address.ts";
import { ActionRegistry, fixedSource, MutableSource, matchScore } from "../src/actions/registry.ts";
import { type ActionDef, ok, ready } from "../src/actions/types.ts";

const action = (address: string, title: string, extra: Partial<ActionDef> = {}): ActionDef => ({
  address,
  title,
  description: "",
  keywords: { en: [] },
  kind: "run",
  properties: {},
  scope: null,
  readOnly: false,
  destructive: false,
  who: "person",
  source: "test",
  check: () => ready(async () => ok(title)),
  ...extra,
});

describe("dashi:// addresses", () => {
  test("parse to a canonical address and a query", () => {
    expect(parseAddress("dashi://settings/appearance/dark-mode")).toEqual({
      address: "dashi://settings/appearance/dark-mode",
      segments: ["settings", "appearance", "dark-mode"],
      query: {},
    });
    expect(parseAddress("  DASHI://Settings/appearance/dark-mode/?value=true#x")).toEqual({
      address: "dashi://settings/appearance/dark-mode",
      segments: ["settings", "appearance", "dark-mode"],
      query: { value: "true" },
    });
    // A key that names an Object member is the first of its kind, not a repeat.
    expect(parseAddress("dashi://x?constructor=1&toString=2&__proto__=3")?.query).toEqual({ constructor: "1", toString: "2", ["__proto__"]: "3" });
    expect(parseAddress("dashi://x?constructor=1&constructor=2")).toBeNull();
    // App ids keep their capitals.
    expect(parseAddress("dashi://app/org.gnome.Nautilus")?.address).toBe("dashi://app/org.gnome.Nautilus");
    expect(parseAddress("dashi://app/dev.dashi.notes/menu/file:new")?.segments).toEqual(["app", "dev.dashi.notes", "menu", "file:new"]);
  });

  test("refuse what isn't one", () => {
    for (const bad of [
      "https://example.com",
      "dashi:/settings",
      "dashi://",
      "dashi://settings//row",
      "dashi://settings/../etc",
      "dashi://settings/a b",
      "dashi://settings/%2e%2e",
      "dashi://settings/%E0%A4%A",
      `dashi://${"a/".repeat(9)}`,
      "dashi://x?1bad=1",
      "dashi://x?a=1&a=2",
      `dashi://x/${"a".repeat(2100)}`,
    ]) {
      expect(parseAddress(bad)).toBeNull();
    }
  });

  test("format, slug, and arguments", () => {
    expect(formatAddress(["window", "w3"])).toBe("dashi://window/w3");
    expect(() => formatAddress(["window", "w 3"])).toThrow();
    expect(slug("New Note…")).toBe("new-note");
    expect(slug("Écran & Son")).toBe("ecran-son");
    expect(slug("…")).toBeNull();
    expect(withArgs("dashi://settings/mouse/scrolling-speed", { value: 1.5 })).toBe("dashi://settings/mouse/scrolling-speed?value=1.5");
    expect(withArgs("dashi://x", { a: null, b: undefined })).toBe("dashi://x");
  });

  test("query values are read by the action's schema", () => {
    const properties = {
      on: { type: "boolean" },
      level: { type: "integer" },
      value: { oneOf: [{ type: "boolean" }, { type: "string" }, { type: "number" }] },
      name: { type: "string" },
      target: { oneOf: [{ type: "string" }, { type: "object" }] },
    };
    expect(argsFromQuery({ on: "true", level: "30", value: "1.5", name: "true", target: '{"app":"x"}', stray: "1" }, properties)).toEqual({
      on: true,
      level: 30,
      value: 1.5,
      name: "true",
      target: { app: "x" },
      stray: "1",
    });
    expect(argsFromQuery({ level: "thirty" }, properties)).toEqual({ level: "thirty" });
  });
});

describe("the registry", () => {
  test("lists by source order, finds by address, and keeps the first of a repeated address", () => {
    const registry = new ActionRegistry();
    registry.add(fixedSource("a", [action("dashi://a/one", "One"), action("dashi://shared", "First")]));
    registry.add(fixedSource("b", [action("dashi://shared", "Second", { who: "agents" }), action("dashi://b/two", "Two", { who: "both" })]));
    expect(registry.list().map((each) => each.title)).toEqual(["One", "First", "Two"]);
    expect(registry.get("dashi://shared")?.title).toBe("First");
    expect(registry.list({ who: "agents" }).map((each) => each.title)).toEqual(["Two"]);
    expect(registry.list({ who: "person" }).map((each) => each.title)).toEqual(["One", "First", "Two"]);
    expect(() => registry.add(fixedSource("a", []))).toThrow();
  });

  test("sources add and take away actions at runtime, and listeners hear it", () => {
    const registry = new ActionRegistry();
    const windows = new MutableSource("windows");
    let heard = 0;
    registry.subscribe(() => heard++);
    const remove = registry.add(windows);
    windows.set([action("dashi://window/w3", "Notes")]);
    expect(registry.get("dashi://window/w3")?.title).toBe("Notes");
    windows.set([]);
    expect(registry.get("dashi://window/w3")).toBeUndefined();
    windows.set([action("dashi://window/w4", "Files")]);
    remove();
    expect(registry.list()).toEqual([]);
    // Gone: its changes are no longer heard.
    const before = heard;
    windows.set([action("dashi://window/w5", "Terminal")]);
    expect(heard).toBe(before);
    expect(heard).toBe(5);
  });

  test("resolve reads a link's arguments by the action's schema", () => {
    const registry = new ActionRegistry();
    registry.add(fixedSource("s", [action("dashi://settings/appearance/dark-mode", "Dark Mode", { properties: { value: { type: "boolean" } } })]));
    expect(registry.resolve("dashi://settings/appearance/dark-mode?value=false")).toMatchObject({ args: { value: false } });
    expect(registry.resolve("dashi://settings/appearance/nothing")).toEqual({ error: "Nothing is at dashi://settings/appearance/nothing." });
    expect(registry.resolve("file:///etc/passwd")).toEqual({ error: "That is not a dashi:// address." });
  });

  test("query: name, then keywords, inside a word only from four letters", () => {
    const registry = new ActionRegistry();
    registry.add(
      fixedSource("s", [
        action("dashi://settings/battery", "Battery & Power", { keywords: { en: ["energy"] } }),
        action("dashi://app/terminal", "Terminal", { keywords: { en: ["shell", "command line"] } }),
        action("dashi://settings/appearance/dark-mode", "Dark Mode", { keywords: { en: ["theme"], de: ["dunkelmodus"] } }),
        action("dashi://settings/display/ecran", "Écran"),
      ]),
    );
    const titles = (text: string) => registry.query(text).map((each) => each.title);
    expect(titles("ter")).toEqual(["Terminal"]);
    expect(titles("tery")).toEqual(["Battery & Power"]);
    expect(titles("dark")).toEqual(["Dark Mode"]);
    expect(titles("dunkel")).toEqual(["Dark Mode"]);
    expect(titles("line")).toEqual(["Terminal"]);
    expect(titles("ecran")).toEqual(["Écran"]);
    expect(titles("")).toEqual([]);
    expect(matchScore(action("x", "Terminal"), "terminal")).toBe(0);
    expect(registry.query("dark", { who: "agents" })).toEqual([]);
  });

  test("refresh asks every source that can, and one that fails doesn't stop the rest", async () => {
    const registry = new ActionRegistry();
    const asked: string[] = [];
    registry.add({ id: "a", actions: () => [], refresh: async () => void asked.push("a") });
    registry.add({
      id: "b",
      actions: () => [],
      refresh: async () => {
        throw new Error("no");
      },
    });
    registry.add({ id: "c", actions: () => [], refresh: async () => void asked.push("c") });
    const error = console.error;
    console.error = () => {};
    await registry.refresh();
    console.error = error;
    expect(asked).toEqual(["a", "c"]);
  });
});
