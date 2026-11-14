/**
 * The bar's row as the field (menubar/field.ts): opening and closing keep
 * the draft, Return sends to the assistant, dictated words land at the
 * caret, no model means nothing is sent, and the others are told (`hub.bar`).
 */

import { describe, expect, test } from "bun:test";
import { BarField, type FieldAsker, insertWords } from "../src/menubar/index.ts";
import { createPillHub } from "../src/shared/pill/index.ts";

function setup(options: { ready?: boolean; asker?: boolean } = {}) {
  const hub = createPillHub();
  const sent: string[] = [];
  const log: string[] = [];
  let ready = options.ready ?? true;
  let jobs = 0;
  const jobListeners = new Set<() => void>();
  const asker: FieldAsker = {
    ready: () => ready,
    send: (text) => {
      sent.push(text);
      return "ask-1";
    },
    setUp: () => log.push("settings"),
  };
  const surfaces: Array<{ output: string | undefined; onClosed: () => void; closed: boolean }> = [];
  const field = new BarField({
    bar: hub.bar,
    commands: hub.barCommands,
    asker: () => (options.asker === false ? null : asker),
    closeMenus: () => log.push("menus closed"),
    defaultOutput: () => "eDP-1",
    jobs: {
      subscribe: (listener) => {
        jobListeners.add(listener);
        return () => jobListeners.delete(listener);
      },
      count: () => jobs,
    },
    openSurface: (output, onClosed) => {
      const surface = { output, onClosed, closed: false };
      surfaces.push(surface);
      return {
        close: () => {
          surface.closed = true;
        },
      };
    },
  });
  return {
    hub,
    field,
    sent,
    log,
    surfaces,
    setReady: (value: boolean) => {
      ready = value;
    },
    setJobs: (count: number) => {
      jobs = count;
      for (const listener of jobListeners) listener();
    },
  };
}

describe("the field", () => {
  test("a click on the mark opens it on that screen, closing an open menu; a second click closes it", () => {
    const { field, hub, log, surfaces } = setup();
    field.toggle("DP-1");
    expect(field.getSnapshot()).toMatchObject({ open: true, output: "DP-1", text: "", noModel: false });
    expect(hub.bar.getSnapshot()).toEqual({ mode: "field", text: "" });
    expect(log).toEqual(["menus closed"]);
    expect(surfaces).toHaveLength(1);
    field.toggle("DP-1");
    expect(field.getSnapshot().open).toBe(false);
    expect(surfaces[0]?.closed).toBe(true);
    expect(hub.bar.getSnapshot()).toEqual({ mode: "rest" });
  });

  test("Esc keeps the draft: it is there the next time, the caret at its end", () => {
    const { field, hub } = setup();
    field.open("DP-1");
    field.type("book me a yoga");
    expect(hub.bar.getSnapshot()).toEqual({ mode: "field", text: "book me a yoga" });
    field.close();
    field.open("DP-1");
    expect(field.getSnapshot()).toMatchObject({ open: true, text: "book me a yoga", caret: 14 });
  });

  test("Return sends the words to the assistant, empties the field and puts the menus back", () => {
    const { field, sent, surfaces } = setup();
    field.open(undefined);
    field.type("  book me a yoga class  ");
    field.submit();
    expect(sent).toEqual(["book me a yoga class"]);
    expect(field.getSnapshot()).toMatchObject({ open: false, text: "" });
    expect(surfaces[0]?.closed).toBe(true);
  });

  test("Return on an empty field does nothing", () => {
    const { field, sent } = setup();
    field.open(undefined);
    field.type("   ");
    field.submit();
    expect(sent).toEqual([]);
    expect(field.getSnapshot().open).toBe(true);
  });

  test("no model set up: the row says so, nothing is sent, and Return opens System Settings", () => {
    const { field, sent, log } = setup({ ready: false });
    field.open(undefined);
    expect(field.getSnapshot().noModel).toBe(true);
    field.insert("these words go nowhere");
    expect(field.getSnapshot().text).toBe("");
    field.submit();
    expect(sent).toEqual([]);
    expect(log).toContain("settings");
    expect(field.getSnapshot().open).toBe(false);
  });

  test("the model went away while typing: Return sends nothing and the row says so, the draft kept", () => {
    const { field, sent, setReady } = setup();
    field.open(undefined);
    field.type("book it");
    setReady(false);
    field.submit();
    expect(sent).toEqual([]);
    expect(field.getSnapshot()).toMatchObject({ open: true, noModel: true, text: "book it" });
  });

  test("before the assistant has started there is no model either", () => {
    const { field } = setup({ asker: false });
    field.open(undefined);
    expect(field.getSnapshot().noModel).toBe(true);
  });

  test("the surface going by itself puts the menus back and keeps the draft", () => {
    const { field, surfaces, hub } = setup();
    field.open(undefined);
    field.type("draft");
    surfaces[0]?.onClosed();
    expect(field.getSnapshot()).toMatchObject({ open: false, text: "draft" });
    expect(hub.bar.getSnapshot()).toEqual({ mode: "rest" });
  });

  test("moving to another screen's bar closes the first surface", () => {
    const { field, surfaces } = setup();
    field.open("DP-1");
    field.open("DP-2");
    expect(surfaces.map((surface) => [surface.output, surface.closed])).toEqual([
      ["DP-1", true],
      ["DP-2", false],
    ]);
    // The old surface's late goodbye changes nothing.
    surfaces[0]?.onClosed();
    expect(field.getSnapshot()).toMatchObject({ open: true, output: "DP-2" });
  });
});

describe("what the others ask and read", () => {
  test("open-field opens on the primary screen with the words given; close-field closes", () => {
    const { field, hub } = setup();
    expect(hub.barCommands.send({ do: "open-field", text: "remind me" })).toBe(true);
    expect(field.getSnapshot()).toMatchObject({ open: true, output: "eDP-1", text: "remind me", caret: 9 });
    hub.barCommands.send({ do: "close-field" });
    expect(field.getSnapshot().open).toBe(false);
  });

  test("insert puts dictated words at the caret, and bumps the revision so the field shows them", () => {
    const { field, hub } = setup();
    field.open(undefined);
    field.type("book a class");
    field.caretAt(4);
    const before = field.getSnapshot().revision;
    hub.barCommands.send({ do: "insert", text: "me" });
    expect(field.getSnapshot()).toMatchObject({ text: "book me a class", caret: 7 });
    expect(field.getSnapshot().revision).toBe(before + 1);
    // Closed, dictated words are not the bar's.
    field.close();
    hub.barCommands.send({ do: "insert", text: "lost" });
    expect(field.getSnapshot().text).toBe("book me a class");
  });

  test("at rest the bar says how many jobs it shows", () => {
    const { hub, setJobs, field } = setup();
    setJobs(2);
    expect(hub.bar.getSnapshot()).toEqual({ mode: "jobs", count: 2 });
    field.open(undefined);
    expect(hub.bar.getSnapshot()).toEqual({ mode: "field", text: "" });
    field.close();
    expect(hub.bar.getSnapshot()).toEqual({ mode: "jobs", count: 2 });
    setJobs(0);
    expect(hub.bar.getSnapshot()).toEqual({ mode: "rest" });
  });
});

test("words go in with a space where they would touch, and none before punctuation", () => {
  expect(insertWords("", 0, " hello ")).toEqual({ text: "hello", caret: 5 });
  expect(insertWords("book", 4, "a class")).toEqual({ text: "book a class", caret: 12 });
  expect(insertWords("book .", 5, "it")).toEqual({ text: "book it.", caret: 7 });
  expect(insertWords("ab", 1, "x")).toEqual({ text: "a x b", caret: 4 });
  expect(insertWords("ab", 9, "")).toEqual({ text: "ab", caret: 2 });
});
