import { describe, expect, test } from "bun:test";
import {
  bool,
  type Infer,
  int,
  lenientList,
  list,
  literal,
  map,
  maybe,
  must,
  nullable,
  num,
  obj,
  optional,
  record,
  refine,
  ShapeError,
  str,
  tagged,
  union,
  withDefault,
} from "../src/index.ts";

const Window = obj({
  id: int({ min: 1 }),
  title: str({ max: 8 }),
  state: literal("normal", "minimized"),
  space: optional(int({ min: 0, max: 15 })),
  parent: nullable(int({ min: 1 })),
});

describe("leaves", () => {
  test("numbers are finite and in range", () => {
    expect(num().parse(1.5)).toEqual({ ok: true, value: 1.5 });
    expect(num().parse(Number.NaN).ok).toBe(false);
    expect(num().parse("1").ok).toBe(false);
    expect(int({ min: 0, max: 3 }).parse(4, "fingers")).toEqual({ ok: false, error: "fingers must be from 0 to 3" });
    expect(int().parse(1.5, "x")).toEqual({ ok: false, error: "x must be a whole number" });
  });

  test("strings: length in characters, pattern, trimming, control characters", () => {
    expect(str({ max: 2 }).parse("éé").ok).toBe(true);
    expect(str({ max: 2 }).parse("abc", "name")).toEqual({ ok: false, error: "name is longer than 2 characters" });
    expect(str({ pattern: /^[a-z]+$/ }).parse("A").ok).toBe(false);
    expect(str({ trim: true, min: 1 }).parse("  ", "label")).toEqual({ ok: false, error: "label is empty" });
    expect(str({ trim: true }).parse(" a ")).toEqual({ ok: true, value: "a" });
    expect(str({ safe: true }).parse("a\u0007").ok).toBe(false);
  });

  test("booleans and literals", () => {
    expect(bool().parse(1).ok).toBe(false);
    expect(literal("a", null).parse(null)).toEqual({ ok: true, value: null });
    expect(literal("a", "b").parse("c", "kind")).toEqual({ ok: false, error: 'kind must be one of "a", "b"' });
  });
});

describe("objects", () => {
  test("parse to a typed value, leaving absent optionals out", () => {
    const value: Infer<typeof Window> = must(Window, { id: 2, title: "Notes", state: "normal", parent: null });
    expect(value).toEqual({ id: 2, title: "Notes", state: "normal", parent: null });
    expect("space" in value).toBe(false);
  });

  test("refuse with the path to what was wrong", () => {
    expect(Window.parse({ id: 2, title: "Notes", state: "normal", parent: 0 }, "window")).toEqual({
      ok: false,
      error: "window.parent must be from 1 to ∞",
    });
    expect(Window.parse({ id: 2, title: "Notes", state: "normal", parent: null, extra: 1 }, "w")).toEqual({
      ok: false,
      error: "w has an unknown field “extra”",
    });
    expect(Window.parse([], "w")).toEqual({ ok: false, error: "w must be an object" });
  });

  test("a loose object drops what it does not name", () => {
    expect(must(obj({ a: int() }, { strict: false }), { a: 1, b: 2 })).toEqual({ a: 1 });
  });

  test("defaults are decided by the shape", () => {
    expect(must(obj({ on: withDefault(bool(), false) }), {})).toEqual({ on: false });
  });

  test("must throws, maybe answers null", () => {
    expect(() => must(int(), "x", "count")).toThrow(ShapeError);
    expect(maybe(int(), "x")).toBeNull();
  });
});

describe("lists, records, unions", () => {
  test("a list refuses at its first bad entry, by index", () => {
    expect(list(int(), { max: 3 }).parse([1, "2"], "swipe")).toEqual({ ok: false, error: "swipe[1] must be a whole number" });
    expect(list(int(), { max: 1 }).parse([1, 2], "swipe")).toEqual({ ok: false, error: "swipe has more than 1 entries" });
  });

  test("a lenient list drops bad entries and cuts to its max", () => {
    expect(must(lenientList(str(), { max: 2 }), ["a", 1, "b", "c"])).toEqual(["a", "b"]);
  });

  test("records check keys and values", () => {
    const shape = record(int(), { key: str({ pattern: /^[a-z]+$/ }) });
    expect(must(shape, { a: 1 })).toEqual({ a: 1 });
    expect(shape.parse({ A: 1 }).ok).toBe(false);
    expect(shape.parse({ a: "1" }, "r")).toEqual({ ok: false, error: "r.a must be a whole number" });
  });

  test("a union takes the first that parses", () => {
    const shape = union(int(), str());
    expect(must(shape, "a")).toBe("a");
    expect(shape.parse(true).ok).toBe(false);
  });

  test("tagged unions parse by their tag", () => {
    const Event = tagged("event", { lock: obj({ locked: bool() }), active: obj({}) });
    expect(must(Event, { event: "lock", locked: true })).toEqual({ event: "lock", locked: true });
    expect(Event.parse({ event: "nope" }, "e").ok).toBe(false);
    expect(Event.parse({ event: "active", x: 1 }, "e")).toEqual({ ok: false, error: "e has an unknown field “x”" });
  });

  test("map and refine", () => {
    const Doubled = map(int(), (n) => n * 2);
    expect(must(Doubled, 2)).toBe(4);
    const Even = refine(int(), (n, where) => (n % 2 === 0 ? null : `${where} must be even`));
    expect(Even.parse(3, "n")).toEqual({ ok: false, error: "n must be even" });
  });

  test("a value with its own error field is not a refusal", () => {
    expect(must(obj({ error: str() }), { error: "x" })).toEqual({ error: "x" });
  });
});

describe("JSON Schema", () => {
  test("says the same as the parser", () => {
    expect(Window.schema()).toEqual({
      type: "object",
      properties: {
        id: { type: "integer", minimum: 1 },
        title: { type: "string", maxLength: 8 },
        state: { enum: ["normal", "minimized"] },
        space: { type: "integer", minimum: 0, maximum: 15 },
        parent: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
      },
      required: ["id", "title", "state", "parent"],
      additionalProperties: false,
    });
    expect(tagged("t", { a: obj({ n: int() }) }).schema()).toEqual({
      oneOf: [{ type: "object", properties: { t: { const: "a" }, n: { type: "integer" } }, required: ["t", "n"], additionalProperties: false }],
    });
  });
});
