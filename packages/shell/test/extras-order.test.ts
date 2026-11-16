import { expect, test } from "bun:test";
import { ExtrasStore, type MenuBarExtra } from "../src/extras/index.ts";

// Pass 42: after a package downgrade and upgrade the bar's fan and keyboard had swapped: the order was the
// order the programs started in (newest leftmost). It is fixed now: tray icons by name, then applets by id.

const NONE = { activate() {}, secondaryActivate() {}, menu: async () => [], choose() {} };
const applet = (connection: number, id: string): MenuBarExtra => ({
  key: `applet:${connection}/${id}`,
  source: "applet",
  title: id,
  icon: null,
  attention: false,
  menuOnClick: false,
  hasMenu: false,
});
const tray = (bus: string, title: string): MenuBarExtra => ({ ...applet(0, title), key: `tray:${bus}/StatusNotifierItem`, source: "tray", title });

const order = (puts: readonly MenuBarExtra[]): string[] => {
  const store = new ExtrasStore();
  for (const extra of puts) store.put(extra, NONE);
  return store.getSnapshot().map((extra) => extra.title);
};

test("the bar's extras keep one order however their programs start", () => {
  const fan = (n: number) => applet(n, "dev.netko.asus-control.fan");
  const keyboard = (n: number) => applet(n, "dev.netko.asus-control.keyboard");
  const weather = (n: number) => applet(n, "dev.example.weather");
  const steam = (bus: string) => tray(bus, "Steam");
  const first = order([fan(1), keyboard(1), weather(2), steam(":1.40")]);
  const again = order([weather(7), steam(":1.93"), keyboard(9), fan(9)]);
  expect(first).toEqual(["Steam", "dev.example.weather", "dev.netko.asus-control.fan", "dev.netko.asus-control.keyboard"]);
  expect(again).toEqual(first);
});

test("a replaced extra keeps its place; a dropped one leaves the others in theirs", () => {
  const store = new ExtrasStore();
  for (const id of ["c", "a", "b"]) store.put(applet(1, id), NONE);
  store.put({ ...applet(1, "a"), label: "21°" }, NONE);
  store.drop("applet:1/b");
  expect(store.getSnapshot().map((extra) => [extra.title, extra.label ?? ""])).toEqual([
    ["a", "21°"],
    ["c", ""],
  ]);
});
