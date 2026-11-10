import { expect, test } from "bun:test";
import { Late, Services } from "../src/boot/services.ts";

test("services stop in the reverse of the order they started", () => {
  const services = new Services();
  const stopped: string[] = [];
  for (const name of ["settings", "spaces", "menus", "dock"]) services.add(name, () => stopped.push(name));
  expect(services.names()).toEqual(["settings", "spaces", "menus", "dock"]);
  expect(services.closeAll()).toEqual([]);
  expect(stopped).toEqual(["dock", "menus", "spaces", "settings"]);
});

test("a stop that throws is logged and the ones after it still run", () => {
  const services = new Services();
  const stopped: string[] = [];
  const logged: string[] = [];
  services.add("first", () => stopped.push("first"));
  services.add("broken", () => {
    throw new Error("no bus");
  });
  services.add("last", () => stopped.push("last"));
  expect(services.closeAll((message) => logged.push(message))).toEqual(["broken"]);
  expect(stopped).toEqual(["last", "first"]);
  expect(logged).toEqual(["dashi-shell: closing broken failed:"]);
});

test("closing twice stops each service once, and a stop that asks to close again is ignored", () => {
  const services = new Services();
  const stopped: string[] = [];
  services.add("settings", () => stopped.push("settings"));
  // A menu bar's surface closing asks the shell to quit again (main.tsx `quit`).
  services.add("menu bars", () => {
    stopped.push("menu bars");
    expect(services.isRunning()).toBe(false);
    expect(services.closeAll()).toEqual([]);
  });
  expect(services.isRunning()).toBe(true);
  services.closeAll();
  services.closeAll();
  expect(stopped).toEqual(["menu bars", "settings"]);
});

test("a service added while closing is not stopped by that close", () => {
  const services = new Services();
  const stopped: string[] = [];
  services.add("first", () => {
    stopped.push("first");
    services.add("late", () => stopped.push("late"));
  });
  services.closeAll();
  expect(stopped).toEqual(["first"]);
});

interface Parts {
  menus: { name: string };
  overview: { name: string } | null;
}

test("a late part read before it is made throws, as a const read before its line would", () => {
  const late = new Late<Parts>();
  expect(() => late.get("menus")).toThrow("menus is used before it has started");
  expect(late.peek("menus")).toBeUndefined();
  const menus = late.set("menus", { name: "menus" });
  expect(menus).toEqual({ name: "menus" });
  expect(late.get("menus")).toBe(menus);
});

test("a late part may be null once made (no compositor, no overview)", () => {
  const late = new Late<Parts>();
  late.set("overview", null);
  expect(late.get("overview")).toBeNull();
  expect(late.peek("overview")).toBeNull();
});
