import { describe, expect, test } from "bun:test";
import { KEYMAP } from "../src/keymap.ts";
import { inClass, type KeyChord, resolveChord, ruleFor } from "../src/keymap-match.ts";

const chord = (mods: KeyChord["mods"], key: string): KeyChord => ({ mods, key });

describe("resolveChord", () => {
  test("terminals get readline's keys for ⌥ and ❖ arrows", () => {
    expect(resolveChord(chord(["alt"], "Left"), "dev.dashi.terminal")).toEqual({ kind: "keys", chords: [{ mods: ["alt"], key: "b" }] });
    expect(resolveChord(chord(["super"], "Left"), "foot")).toEqual({ kind: "keys", chords: [{ mods: ["ctrl"], key: "a" }] });
    expect(resolveChord(chord(["alt"], "BackSpace"), "kitty")).toEqual({ kind: "keys", chords: [{ mods: ["ctrl"], key: "w" }] });
  });

  test("elsewhere ❖← is Home and ⌥← is Ctrl+←, Shift passing through", () => {
    expect(resolveChord(chord(["super"], "Left"), "helium")).toEqual({ kind: "keys", chords: [{ mods: [], key: "Home" }] });
    expect(resolveChord(chord(["super", "shift"], "Left"), "helium")).toEqual({ kind: "keys", chords: [{ mods: ["shift"], key: "Home" }] });
    expect(resolveChord(chord(["alt"], "Left"), "helium")).toEqual({ kind: "keys", chords: [{ mods: ["ctrl"], key: "Left" }] });
  });

  test("❖ chords become the app's Ctrl chord, Ctrl+Shift in terminals", () => {
    expect(resolveChord(chord(["super"], "c"), "helium")).toEqual({ kind: "keys", chords: [{ mods: ["ctrl"], key: "c" }] });
    expect(resolveChord(chord(["super"], "c"), "foot")).toEqual({ kind: "keys", chords: [{ mods: ["ctrl", "shift"], key: "c" }] });
  });

  test("Dashi's apps hand ❖ chords to their menus; the desktop keeps its own", () => {
    expect(resolveChord(chord(["super"], "s"), "dev.dashi.notes")).toEqual({ kind: "bind", name: "app-chord" });
    expect(resolveChord(chord(["super"], "q"), "helium")).toEqual({ kind: "bind", name: "quit-app" });
    expect(resolveChord(chord(["super", "ctrl"], "x"), "helium")).toEqual({ kind: "swallow" });
  });

  test("taps press each chord; plain keys pass as they are", () => {
    expect(resolveChord(chord(["super"], "BackSpace"), "helium")).toEqual({
      kind: "keys",
      chords: [
        { mods: ["shift"], key: "Home" },
        { mods: [], key: "BackSpace" },
      ],
    });
    expect(resolveChord(chord([], "Left"), "foot")).toEqual({ kind: "keys", chords: [{ mods: [], key: "Left" }] });
    expect(ruleFor(chord([], "a"), "foot")).toBeNull();
  });
});

describe("inClass", () => {
  test("exact ids and prefixes", () => {
    expect(inClass(KEYMAP, "metal", "dev.dashi.files")).toBe(true);
    expect(inClass(KEYMAP, "metal", "")).toBe(true);
    expect(inClass(KEYMAP, "terminal", "foot")).toBe(true);
    expect(inClass(KEYMAP, "terminal", "footx")).toBe(false);
    expect(inClass(KEYMAP, "nope", "foot")).toBe(false);
  });
});
