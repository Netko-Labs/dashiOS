import { describe, expect, test } from "bun:test";
import { KEYMAP, LOCKED_RULES, withSwitcher } from "../src/keymap.ts";
import { inClass, type KeyChord, resolveChord, resolveLocked, ruleFor } from "../src/keymap-match.ts";
import { currentKeymap, idleKeymap } from "../src/keymap-state.ts";
import { withLauncher } from "../src/launcher/keys.ts";
import { withTyping } from "../src/launcher/type-ahead.ts";

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

describe("resolveLocked (the lock screen's keys)", () => {
  test("❖A selects in the lock screen's field, and ❖C ❖X ❖V ❖Z are its Ctrl chords", () => {
    for (const key of ["a", "c", "x", "v", "z"]) {
      expect(resolveLocked(chord(["super"], key))).toEqual({ kind: "keys", chords: [{ mods: ["ctrl"], key }] });
    }
    expect(resolveLocked(chord(["super", "shift"], "z"))).toEqual({ kind: "keys", chords: [{ mods: ["ctrl", "shift"], key: "z" }] });
    expect(resolveLocked(chord(["super"], "Left"))).toEqual({ kind: "keys", chords: [{ mods: [], key: "Home" }] });
    expect(resolveLocked(chord(["alt"], "BackSpace"))).toEqual({ kind: "keys", chords: [{ mods: ["ctrl"], key: "BackSpace" }] });
  });

  test("any other ❖ chord does nothing there, rather than typing its letter into the password", () => {
    for (const mods of [["super"], ["super", "shift"], ["super", "ctrl"], ["super", "alt"], ["super", "ctrl", "alt"]] as const) {
      expect(resolveLocked(chord(mods, "q"))).toEqual({ kind: "swallow" });
    }
    expect(resolveLocked(chord(["super", "shift"], "3"))).toEqual({ kind: "swallow" });
  });

  test("plain keys and Ctrl chords reach the field as they are", () => {
    expect(resolveLocked(chord([], "a"))).toEqual({ kind: "keys", chords: [{ mods: [], key: "a" }] });
    expect(resolveLocked(chord(["ctrl"], "a"))).toEqual({ kind: "keys", chords: [{ mods: ["ctrl"], key: "a" }] });
    expect(resolveLocked(chord([], "Return"))).toEqual({ kind: "keys", chords: [{ mods: [], key: "Return" }] });
  });

  test("no locked rule binds or names an app (the compositor refuses a keymap that does)", () => {
    for (const rule of KEYMAP.locked ?? []) {
      expect(rule.bind).toBeUndefined();
      expect(rule.app).toBeUndefined();
    }
    expect(KEYMAP.locked).toBe(LOCKED_RULES);
  });

  test("every keymap the shell sends keeps the lock screen's rules", () => {
    for (const keymap of [currentKeymap(), idleKeymap(), withSwitcher(currentKeymap()), withTyping(currentKeymap()), withLauncher(currentKeymap())]) {
      expect(keymap.locked).toBe(LOCKED_RULES);
    }
  });
});
