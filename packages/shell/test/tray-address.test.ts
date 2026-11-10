import { describe, expect, test } from "bun:test";
import { DEFAULT_ITEM_PATH, ItemRegistry, itemId, itemKey, nameGone, parseItemId, parseRegistration } from "../src/tray/lib/address.ts";

describe("parseRegistration", () => {
  test("a bus name is an item at the default path", () => {
    expect(parseRegistration("org.kde.StatusNotifierItem-4711-1", ":1.9")).toEqual({
      bus: "org.kde.StatusNotifierItem-4711-1",
      path: DEFAULT_ITEM_PATH,
    });
    expect(parseRegistration(":1.42", ":1.42")).toEqual({ bus: ":1.42", path: "/StatusNotifierItem" });
  });

  test("an object path is an item on the caller's connection", () => {
    expect(parseRegistration("/org/ayatana/NotificationItem/nm_applet", ":1.7")).toEqual({
      bus: ":1.7",
      path: "/org/ayatana/NotificationItem/nm_applet",
    });
  });

  test("a whole id is split into its name and path", () => {
    expect(parseRegistration(":1.8/StatusNotifierItem", ":1.8")).toEqual({ bus: ":1.8", path: "/StatusNotifierItem" });
  });

  test("refuses what names no item", () => {
    expect(parseRegistration("/no//double", ":1.7")).toBeNull();
    expect(parseRegistration("/StatusNotifierItem", undefined)).toBeNull();
    expect(parseRegistration("not a name", ":1.7")).toBeNull();
    expect(parseRegistration("", ":1.7")).toBeNull();
    expect(parseRegistration(42, ":1.7")).toBeNull();
    expect(parseRegistration(":1.7/trailing/", ":1.7")).toBeNull();
  });
});

describe("item ids", () => {
  test("are the bus name followed by the path, and keys add the source", () => {
    const address = { bus: ":1.42", path: "/StatusNotifierItem" };
    expect(itemId(address)).toBe(":1.42/StatusNotifierItem");
    expect(itemKey(address)).toBe("tray::1.42/StatusNotifierItem");
  });

  test("read back as another watcher lists them", () => {
    expect(parseItemId(":1.42/org/ayatana/NotificationItem/x")).toEqual({ bus: ":1.42", path: "/org/ayatana/NotificationItem/x" });
    expect(parseItemId("org.kde.StatusNotifierItem-1-1")).toEqual({ bus: "org.kde.StatusNotifierItem-1-1", path: DEFAULT_ITEM_PATH });
    expect(parseItemId("/StatusNotifierItem")).toBeNull();
    expect(parseItemId(null)).toBeNull();
  });
});

describe("ItemRegistry", () => {
  test("lists each item once", () => {
    const registry = new ItemRegistry();
    expect(registry.add({ bus: ":1.1", path: "/StatusNotifierItem" })).toBe("added");
    expect(registry.add({ bus: ":1.1", path: "/StatusNotifierItem" })).toBe("known");
    expect(registry.add({ bus: ":1.1", path: "/Other" })).toBe("added");
    expect(registry.ids()).toEqual([":1.1/StatusNotifierItem", ":1.1/Other"]);
  });

  test("drops every item of an owner that left, and only those", () => {
    const registry = new ItemRegistry();
    registry.add({ bus: ":1.1", path: "/StatusNotifierItem" });
    registry.add({ bus: ":1.1", path: "/Other" });
    registry.add({ bus: ":1.10", path: "/StatusNotifierItem" });
    registry.add({ bus: "org.kde.StatusNotifierItem-5-1", path: "/StatusNotifierItem" });
    expect(registry.ownerGone(":1.1").map(itemId)).toEqual([":1.1/StatusNotifierItem", ":1.1/Other"]);
    expect(registry.ownerGone("org.kde.StatusNotifierItem-5-1")).toHaveLength(1);
    expect(registry.ownerGone(":1.99")).toEqual([]);
    expect(registry.ids()).toEqual([":1.10/StatusNotifierItem"]);
  });

  test("stops at its limit", () => {
    const registry = new ItemRegistry(2);
    registry.add({ bus: ":1.1", path: "/a" });
    registry.add({ bus: ":1.1", path: "/b" });
    expect(registry.add({ bus: ":1.1", path: "/c" })).toBe("full");
    expect(registry.remove(":1.1/a")).toBe(true);
    expect(registry.add({ bus: ":1.1", path: "/c" })).toBe("added");
  });
});

describe("nameGone", () => {
  test("is the name whose owner left", () => {
    expect(nameGone([":1.5", ":1.5", ""])).toBe(":1.5");
    expect(nameGone(["org.example.App", ":1.5", ""])).toBe("org.example.App");
  });

  test("is null when a name gains or changes its owner, or the body is malformed", () => {
    expect(nameGone([":1.5", "", ":1.5"])).toBeNull();
    expect(nameGone(["org.example.App", ":1.5", ":1.6"])).toBeNull();
    expect(nameGone([":1.5", 1, ""])).toBeNull();
    expect(nameGone([])).toBeNull();
  });
});
