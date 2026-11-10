import { describe, expect, test } from "bun:test";
import { int, list, str } from "@dashi/shape";
import { ProtocolError, Variant } from "../src/shared/dbus/index.ts";
import { readReply, value, values, variantOf } from "../src/shared/dbus/lib/reply.ts";

describe("reading a D-Bus reply with a shape", () => {
  test("one value", () => {
    expect(readReply("GetNameOwner", [":1.42"], value(str()))).toBe(":1.42");
    expect(readReply("ListNames", [["a.b", "c.d"]], value(list(str())))).toEqual(["a.b", "c.d"]);
  });

  test("several values in order, extras left alone", () => {
    expect(readReply("Stat", ["name", 7, true], values(str(), int()))).toEqual(["name", 7]);
  });

  test("a reply of the wrong kind is a ProtocolError that names the call and the value", () => {
    expect(() => readReply("GetNameOwner", [42], value(str()))).toThrow(ProtocolError);
    expect(() => readReply("GetNameOwner", [42], value(str()))).toThrow("GetNameOwner reply[0] must be a string");
    expect(() => readReply("ListNames", [["a", 1]], value(list(str())))).toThrow("ListNames reply[0][1] must be a string");
  });

  test("a reply with too few values is refused", () => {
    expect(() => readReply("Stat", ["name"], values(str(), int()))).toThrow("Stat reply has 1 values, not 2");
    expect(() => readReply("GetNameOwner", [], value(str()))).toThrow(ProtocolError);
  });

  test("a variant holds a value of the shape, or is refused", () => {
    expect(readReply("Get", [new Variant("s", "dark")], value(variantOf(str())))).toBe("dark");
    expect(() => readReply("Get", [new Variant("i", 3)], value(variantOf(str())))).toThrow(ProtocolError);
    expect(() => readReply("Get", ["dark"], value(variantOf(str())))).toThrow("must be a variant");
  });
});
