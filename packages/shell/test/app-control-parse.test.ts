// The app's development control channel (apps/kit/lib/control.ts): a line is parsed, never cast.
import { expect, test } from "bun:test";
import { parseControl } from "../apps/kit/lib/control.ts";

test("a simulation command is taken when it is one of mirin's", () => {
  expect(parseControl('{"sim":{"kind":"scroll","id":"hours","dy":-120}}')).toEqual({ sim: { kind: "scroll", id: "hours", dy: -120 } });
  expect(parseControl('{"sim":{"kind":"click","x":10,"y":20}}')).toEqual({ sim: { kind: "click", x: 10, y: 20 } });
  expect(parseControl('{"sim":{"kind":"window","action":"zoom"}}')).toEqual({ sim: { kind: "window", action: "zoom" } });
});

test("a command of no known kind, or missing what its kind needs, is refused", () => {
  expect(parseControl('{"sim":{"kind":"scroll","id":"hours"}}')).toBeNull();
  expect(parseControl('{"sim":{"kind":"reboot"}}')).toBeNull();
  expect(parseControl('{"sim":"click"}')).toBeNull();
  expect(parseControl("not json")).toBeNull();
});
