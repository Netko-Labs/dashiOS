import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineWith, parseWait } from "../browser-extension/src/page/wait.ts";
import { until, waitAnswer, waitWords } from "../src/agents/desktop/wait.ts";
import { parseCall } from "../src/agents/index.ts";
import { scopeOf } from "../src/agents/tools/index.ts";
import { fakeClockEachTest } from "./support/time.ts";

const call = (args: Record<string, unknown>) => parseCall({ name: "wait_for", arguments: args });

describe("wait_for's arguments", () => {
  test("exactly one thing is waited for, with a timeout of 10 s unless given", () => {
    expect(call({ text: "Welcome" })).toEqual({ name: "wait_for", until: { text: "Welcome" }, seconds: 10, tab: null, window: null });
    expect(call({ text_gone: "Loading…", timeout: 30, tab: "t4" })).toEqual({
      name: "wait_for",
      until: { textGone: "Loading…" },
      seconds: 30,
      tab: 4,
      window: null,
    });
    expect(call({ element: "[12]", state: "enabled" })).toMatchObject({ until: { ref: 12, state: "enabled" } });
    expect(call({ element: 12 })).toMatchObject({ until: { ref: 12, state: "present" } });
    expect(call({ page: "quiet" })).toMatchObject({ until: { page: "quiet" } });
    expect(call({ window_title: "Save As" })).toMatchObject({ until: { window: "Save As" } });
    expect(call({ file: "~/Downloads/report.pdf" })).toMatchObject({ until: { file: "~/Downloads/report.pdf" } });
  });

  test("none, two, a state without an element, or more than a minute are refused in words", () => {
    expect(call({})).toEqual({ arguments: expect.stringContaining("exactly one") });
    expect(call({ text: "a", page: "loaded" })).toEqual({ arguments: expect.stringContaining("exactly one") });
    expect(call({ text: "a", state: "gone" })).toEqual({ arguments: "`state` goes with `element`." });
    expect(call({ text: "a", timeout: 61 })).toEqual({ arguments: expect.stringContaining("60") });
    expect(call({ page: "idle" })).toEqual({ arguments: "`page` is loaded or quiet." });
  });

  test("a page needs websites, a window seeing windows, a file the files", () => {
    const scope = (args: Record<string, unknown>) => {
      const parsed = call(args);
      if ("arguments" in parsed || "unknown" in parsed) throw new Error("refused");
      return scopeOf(parsed);
    };
    expect(scope({ text: "x" })).toBe("web");
    expect(scope({ page: "loaded" })).toBe("web");
    expect(scope({ window_title: "x" })).toBe("see");
    expect(scope({ file: "/home/x/a" })).toBe("files");
  });
});

describe("what a wait answers", () => {
  test("met, with the line the text was found in and how long it took", () => {
    const met = waitAnswer({ text: "signed in" }, true, 1234, { detail: "You are signed in as Alex Kim" });
    expect(met.content[0]).toEqual({ type: "text", text: "Done waiting for “signed in” to appear: after 1.2 s. It is in: “You are signed in as Alex Kim”." });
    expect(met.structuredContent).toMatchObject({ met: true, ms: 1234 });
    const late = waitAnswer({ ref: 7, state: "enabled" }, false, 10_000, { detail: "there, but disabled" });
    expect(late.content[0]).toEqual({ type: "text", text: "Waited 10 s for element [7] to be enabled; it didn't happen. Now: there, but disabled." });
    expect(late.isError).toBeUndefined();
    expect(waitWords({ page: "quiet" })).toBe("the page to stop changing");
  });
});

describe("the page's own matching", () => {
  test("text is found case- and space-blind, and the whole line comes back", () => {
    expect(lineWith("Menu\nWelcome back,   Alex\nFooter", "welcome back, alex")).toBe("Welcome back,   Alex");
    expect(lineWith("Loading…", "loaded")).toBeNull();
    expect(lineWith("anything", "  ")).toBeNull();
  });

  test("a message is read into a wait, or refused", () => {
    expect(parseWait({ kind: "text", text: "x" })).toEqual({ kind: "text", text: "x" });
    expect(parseWait({ kind: "element", ref: 3, state: "bogus" })).toEqual({ kind: "element", ref: 3, state: "present" });
    expect(parseWait({ kind: "quiet" })).toEqual({ kind: "quiet", quietMs: 500 });
    expect(parseWait({ kind: "text" })).toBeNull();
    expect(parseWait({ kind: "eval" })).toBeNull();
  });
});

describe("waiting in the shell", () => {
  const clock = fakeClockEachTest();

  test("a window title is looked for on each event and between them, until the deadline", async () => {
    let titles: string[] = [];
    let wake: () => void = () => {};
    const done = until(
      async () => titles.some((t) => t.includes("Save")),
      5000,
      250,
      (again) => {
        wake = again;
        return () => {};
      },
      new AbortController().signal,
    );
    await clock.advance(1000);
    titles = ["Save As"];
    wake();
    await clock.advance(1);
    expect(await done).toBe(true);
  });

  test("nothing by the deadline is false; a cancel ends it at once", async () => {
    const never = until(
      async () => false,
      2000,
      250,
      () => () => {},
      new AbortController().signal,
    );
    await clock.advance(2000);
    expect(await never).toBe(false);
    const controller = new AbortController();
    const cancelled = until(
      async () => false,
      60_000,
      250,
      () => () => {},
      controller.signal,
    );
    controller.abort();
    expect(await cancelled).toBe(false);
  });

  test("a file that appears is seen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashi-wait-"));
    try {
      const path = join(dir, "report.pdf");
      const done = until(
        async () => Bun.file(path).exists(),
        5000,
        500,
        () => () => {},
        new AbortController().signal,
      );
      writeFileSync(path, "x");
      await clock.advance(500);
      expect(await done).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
