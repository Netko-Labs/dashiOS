// A listed file moved with `git mv` keeps its list entry.
import { describe, expect, test } from "bun:test";
import { type Counts, carryRenames } from "../ratchet.ts";
import { follow, parseRenames } from "../renames.ts";

const there =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

describe("renames", () => {
  test("reads renames from name-status output and ignores the rest", () => {
    const text = "R100\ta.ts\tb.ts\nM\tc.ts\nA\td.ts\nR087\te/f.ts\tg/f.ts\n";
    expect([...parseRenames(text)]).toEqual([
      ["a.ts", "b.ts"],
      ["e/f.ts", "g/f.ts"],
    ]);
  });

  test("follows a chain to the path that exists", () => {
    const moved = new Map([
      ["a.ts", "b.ts"],
      ["b.ts", "c.ts"],
    ]);
    expect(follow("a.ts", moved, there("c.ts"))).toBe("c.ts");
    expect(follow("a.ts", moved, there("a.ts"))).toBe("a.ts");
    expect(follow("x.ts", moved, there())).toBe("x.ts");
  });

  test("a loop in git's output ends", () => {
    const moved = new Map([
      ["a.ts", "b.ts"],
      ["b.ts", "a.ts"],
    ]);
    expect(follow("a.ts", moved, there())).toMatch(/^[ab]\.ts$/);
  });
});

describe("carryRenames", () => {
  const moved = new Map([["old/view.tsx", "new/view.tsx"]]);

  test("moves the key at the same count", () => {
    const entries: Counts = new Map([["old/view.tsx", 340]]);
    const carried = carryRenames(entries, undefined, new Map([["old/view.tsx", "new/view.tsx"]]));
    expect([...carried]).toEqual([["old/view.tsx", "new/view.tsx"]]);
    expect([...entries]).toEqual([["new/view.tsx", 340]]);
  });

  test("leaves the key when the new file no longer offends", () => {
    const entries: Counts = new Map([["old/view.tsx", 340]]);
    carryRenames(entries, new Map(), moved);
    expect([...entries]).toEqual([["old/view.tsx", 340]]);
  });

  test("never overwrites an entry that is already there", () => {
    const entries: Counts = new Map([
      ["old/view.tsx", 340],
      ["new/view.tsx", 320],
    ]);
    carryRenames(entries, undefined, moved);
    expect(entries.get("new/view.tsx")).toBe(320);
    expect(entries.get("old/view.tsx")).toBe(340);
  });
});
