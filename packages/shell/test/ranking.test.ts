import { describe, expect, test } from "bun:test";
import { buildIndex, fold, prepare, rank } from "../src/launcher/ranking/index.ts";
import { fuzzyScore, withinOneEdit } from "../src/launcher/ranking/lib/match.ts";

describe("folding", () => {
  test("case and accents fold; letters that don't decompose are spelled out", () => {
    expect(fold("Écran")).toBe("ecran");
    expect(fold("Straße")).toBe("strasse");
    expect(fold("Ærø Łódź")).toBe("aero lodz");
  });

  test("words start at spaces, punctuation and camel case", () => {
    expect(prepare("System Settings")).toMatchObject({ text: "systemsettings", words: ["system", "settings"], initials: "ss" });
    expect(prepare("Wi-Fi").text).toBe("wifi");
    expect(prepare("GitHub Desktop").initials).toBe("ghd");
    expect(prepare("VSCode").words).toEqual(["vs", "code"]);
    expect(prepare("Battery & Power").words).toEqual(["battery", "power"]);
  });
});

describe("kinds", () => {
  test("text another program chose never outranks an exact name, even picked", () => {
    const mixed = buildIndex([
      { id: "window", kind: "window", names: ["Terminal"], foreign: true },
      { id: "app", kind: "app", names: ["Terminal"] },
    ]);
    const signals = { picks: () => new Map([["window", 5]]), frecency: (id: string) => (id === "window" ? 100 : 0) };
    expect(rank(mixed, "terminal", { signals }).map((result) => result.item.id)).toEqual(["app", "window"]);
  });

  test("on a tie an app comes before a pane, a pane before a menu row", () => {
    const tied = buildIndex([
      { id: "menu", kind: "menu", names: ["Sound"] },
      { id: "pane", kind: "pane", names: ["Sound"] },
      { id: "app", kind: "app", names: ["Sound"] },
    ]);
    expect(rank(tied, "sound").map((result) => result.item.id)).toEqual(["app", "pane", "menu"]);
  });
});

describe("the matchers", () => {
  test("one edit: insertion, deletion, substitution, swap of neighbors", () => {
    expect(withinOneEdit("fierfox", "firefox")).toBe(true);
    expect(withinOneEdit("firefx", "firefox")).toBe(true);
    expect(withinOneEdit("firefoxx", "firefox")).toBe(true);
    expect(withinOneEdit("firefax", "firefox")).toBe(true);
    expect(withinOneEdit("fierfx", "firefox")).toBe(false);
    expect(withinOneEdit("abc", "abc")).toBe(true);
  });

  test("fuzzy starts at a word start and never jumps into a word's middle across words", () => {
    expect(fuzzyScore("ter", prepare("Battery & Power"))).toBeNull();
    expect(fuzzyScore("ter", prepare("Text Editor"))).toBeNull();
    expect(fuzzyScore("msg", prepare("Messages"))).not.toBeNull();
    expect(fuzzyScore("tedit", prepare("Text Editor"))).not.toBeNull();
    expect(fuzzyScore("sset", prepare("System Settings"))).not.toBeNull();
  });

  test("three letters spread through one word only as an abbreviation: a word is looked for as itself", () => {
    expect(fuzzyScore("tea", prepare("Terminal"))).toBeNull();
    expect(fuzzyScore("trm", prepare("Terminal"))).not.toBeNull();
  });
});
