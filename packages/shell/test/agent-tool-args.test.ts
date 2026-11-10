/**
 * A tool's arguments are one shape (agents/tools/args.ts): the listing agents
 * read and the check that runs when they call come from the same value, so a
 * listed argument is one the check reads and a required one is refused when
 * left out.
 */

import { describe, expect, test } from "bun:test";
import { wholeArg } from "../src/agents/tools/args.ts";
import { parseCall, TOOLS } from "../src/agents/tools/index.ts";

describe("tool arguments", () => {
  test("every tool's required arguments are listed, and the check refuses a call without them", () => {
    for (const def of TOOLS) {
      const listed = Object.keys(def.properties);
      for (const name of def.required ?? []) expect(listed).toContain(name);
      if ((def.required ?? []).length === 0) continue;
      const refused = parseCall({ name: def.name, arguments: {} });
      expect("arguments" in refused).toBe(true);
    }
  });

  test("an argument the listing doesn't name is refused, naming what the tool takes", () => {
    const refused = parseCall({ name: "list_notifications", arguments: { limit: 3, colour: "red" } });
    expect(refused).toEqual({ arguments: "`colour` is not an argument of list_notifications; it takes limit." });
  });

  test("a whole-number argument lists its range and refuses outside it with the tool's own words", () => {
    const limit = wholeArg(1, 50, "`limit` must be a whole number from 1 to 50.", "How many.");
    expect(limit.schema()).toEqual({ type: "integer", minimum: 1, maximum: 50, description: "How many." });
    expect(limit.parse(51)).toEqual({ ok: false, error: "`limit` must be a whole number from 1 to 50." });
    expect(limit.parse(2.5).ok).toBe(false);
    expect(limit.parse(3)).toEqual({ ok: true, value: 3 });
  });

  test("an optional argument may be left out, and takes its default in the call", () => {
    expect(parseCall({ name: "list_notifications", arguments: {} })).toEqual({ name: "list_notifications", limit: 20 });
    expect(parseCall({ name: "list_notifications", arguments: { limit: 0 } })).toEqual({ arguments: "`limit` must be a whole number from 1 to 50." });
  });

  test("a window id reads as the compositor's number and says why when it isn't one", () => {
    expect(parseCall({ name: "focus_window", arguments: { window: "w3" } })).toEqual({ name: "focus_window", window: 3 });
    expect(parseCall({ name: "focus_window", arguments: { window: "front" } })).toEqual({ arguments: '`front` is not a window id; ids look like "w3".' });
    expect(parseCall({ name: "focus_window", arguments: {} })).toEqual({ arguments: '`window` is required: an id from list_windows, like "w3".' });
  });
});
