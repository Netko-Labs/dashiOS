/**
 * An agent at work on another Desktop (agents/desktop/elsewhere.ts): the
 * tool's arguments, the Space it works in, the Space it added going again
 * once empty, and which Space a new window opens on.
 */

import { describe, expect, test } from "bun:test";
import { parseCall } from "../src/agents/tools/registry.ts";
import { MAX_SPACES } from "../src/spaces/model.ts";
import { desk, window, words } from "./support/elsewhere.ts";

describe("work_in_space's arguments", () => {
  test("a Space's number as people count, a new one, or back where the person is", () => {
    expect(parseCall({ name: "work_in_space", arguments: { space: 3 } })).toEqual({ name: "work_in_space", space: 2 });
    expect(parseCall({ name: "work_in_space", arguments: { space: "new" } })).toEqual({ name: "work_in_space", space: "new" });
    expect(parseCall({ name: "work_in_space", arguments: { space: "shown" } })).toEqual({ name: "work_in_space", space: "shown" });
    for (const space of [0, 17, 1.5, "next", null, undefined]) {
      expect(parseCall({ name: "work_in_space", arguments: { space } })).toEqual({
        arguments: '`space` must be a Space number from list_spaces (1 to 16), "new", or "shown".',
      });
    }
  });
});

describe("the Space an agent works in", () => {
  test("a new one is added at the end, named in the answer, and the bar says where", async () => {
    const d = desk(2);
    const result = await d.elsewhere.go("new", d.ctx);
    expect(result.structuredContent).toMatchObject({ space: 3, name: "Desktop 3", shows: false, added: true });
    expect([d.elsewhere.space, d.elsewhere.away, d.elsewhere.label]).toEqual([2, 2, "Desktop 3"]);
    expect(d.said).toEqual(["Working on Desktop 3"]);
    // Apps there that raise themselves must not move the screen: the compositor is told which Space.
    expect(d.quiet.at(-1)).toEqual([2]);
  });

  test("no room is said plainly, and nothing changes", async () => {
    const d = desk(MAX_SPACES);
    const result = await d.elsewhere.go("new", d.ctx);
    expect(result.isError).toBe(true);
    expect(words(result)).toContain("There are already 16 Spaces, the most there can be.");
    expect(d.elsewhere.space).toBeNull();
    expect(d.state.count).toBe(MAX_SPACES);
  });

  test("a Space there is not, and a full-screen window's own Desktop, are refused", async () => {
    const d = desk(3);
    d.state.fullscreen[1] = 7;
    expect(words(await d.elsewhere.go(5, d.ctx))).toBe("There is no Space 6; list_spaces shows the 3 there are.");
    expect(words(await d.elsewhere.go(1, d.ctx))).toBe("Space 2 is a full-screen window's own Desktop; nothing else goes there.");
    expect(d.elsewhere.space).toBeNull();
  });

  test("the Space that shows is said to show, and is not worked in out of sight", async () => {
    const d = desk(2);
    const result = await d.elsewhere.go(0, d.ctx);
    expect(result.structuredContent).toMatchObject({ space: 1, shows: true, added: false });
    expect(d.elsewhere.away).toBeNull();
  });

  test("it is followed while Spaces come and go before it", async () => {
    const d = desk(3);
    await d.elsewhere.go(2, d.ctx);
    d.followed.inserted(1);
    d.state.count++;
    expect(d.elsewhere.space).toBe(3);
    d.followed.removed(0);
    d.state.count--;
    expect(d.elsewhere.space).toBe(2);
    // The Spaces were renumbered: the compositor hears the quiet ones again.
    d.emit({ event: "space", current: 0, previous: 0, count: 3 });
    expect(d.quiet.at(-1)).toEqual([2]);
    // Removed under it (the person closed it in Mission Control): it works where the person is again.
    d.followed.removed(2);
    expect([d.elsewhere.space, d.elsewhere.label]).toEqual([null, null]);
  });
});

describe("a Space the agent added cleans up after itself", () => {
  test("empty, it goes when the agent leaves, works elsewhere, or goes back", async () => {
    for (const next of ["leave", "shown", 0] as const) {
      const d = desk(2);
      await d.elsewhere.go("new", d.ctx);
      expect(d.state.count).toBe(3);
      if (next === "leave") await d.elsewhere.leave();
      else await d.elsewhere.go(next, d.ctx);
      expect(d.state.count).toBe(2);
      expect(d.quiet.at(-1)).toEqual(next === 0 ? [0] : []);
    }
  });

  test("with a window left on it, it stays", async () => {
    const d = desk(2);
    await d.elsewhere.go("new", d.ctx);
    d.state.windows.push(window(4, 2));
    await d.elsewhere.leave();
    expect(d.state.count).toBe(3);
    expect(d.elsewhere.space).toBeNull();
  });

  test("a Space it did not add is never removed, empty or not", async () => {
    const d = desk(3);
    await d.elsewhere.go(2, d.ctx);
    await d.elsewhere.leave();
    expect(d.state.count).toBe(3);
  });

  test("the one the person is looking at stays: taking it away would move their screen", async () => {
    const d = desk(2);
    await d.elsewhere.go("new", d.ctx);
    d.state.current = 2;
    await d.elsewhere.leave();
    expect(d.state.count).toBe(3);
  });
});

describe("where a new window opens", () => {
  const placing = (more: Record<string, unknown> = {}) => ({ id: 9, appId: "org.gnome.Calculator", title: "", width: 400, height: 300, ...more });

  test("nobody asked: the Space that shows", async () => {
    const d = desk(3, [window(1, 0)]);
    expect(await d.places.spaceFor(placing({ pid: 101 }))).toBeNull();
    await d.elsewhere.go(2, d.ctx);
    // An agent works on Desktop 3, but this window is no one's it opened.
    expect(await d.places.spaceFor(placing({ pid: 555 }))).toBeNull();
  });

  test("the window an agent is opening goes to its Space, by its process or its app", async () => {
    const d = desk(3);
    await d.elsewhere.go(2, d.ctx);
    const opening = { pid: null as number | null, owns: (appId: string) => appId === "org.gnome.Calculator" };
    const release = d.elsewhere.claim(opening);
    expect(await d.places.spaceFor(placing())).toBe(2);
    expect(await d.places.spaceFor(placing({ appId: "other" }))).toBeNull();
    // The launch's process is known once it started: its children's windows are its own.
    opening.pid = 700;
    expect(await d.places.spaceFor(placing({ appId: "other", pid: 701 }))).toBe(2);
    release();
    expect(await d.places.spaceFor(placing())).toBeNull();
  });

  test("an agent that works where the person is claims nothing", async () => {
    const d = desk(3);
    d.elsewhere.claim({ pid: null, owns: () => true })();
    const release = d.elsewhere.claim({ pid: null, owns: () => true });
    expect(await d.places.spaceFor(placing())).toBeNull();
    release();
    // Its Space shows now (the person went to look): the window opens there as any other.
    await d.elsewhere.go(2, d.ctx);
    d.state.current = 2;
    d.elsewhere.claim({ pid: null, owns: () => true });
    expect(await d.places.spaceFor(placing())).toBeNull();
  });

  test("nothing an agent opens goes onto a full-screen window's own Desktop", async () => {
    const d = desk(3);
    await d.elsewhere.go(2, d.ctx);
    d.state.fullscreen[2] = 7;
    d.elsewhere.claim({ pid: null, owns: () => true });
    expect(await d.places.spaceFor(placing())).toBeNull();
  });

  test("a dialog goes where its window is", async () => {
    const d = desk(3, [window(1, 0), window(2, 2)]);
    expect(await d.places.spaceFor(placing({ parent: 2 }))).toBe(2);
    expect(await d.places.spaceFor(placing({ parent: 1 }))).toBeNull();
  });

  test("a new window of an app that is all on an agent's Space opens there; one the person also has, with them", async () => {
    const d = desk(3, [window(1, 2, { pid: 300 }), window(2, 2, { pid: 300 }), window(3, 0, { pid: 400 }), window(4, 2, { pid: 400 })]);
    expect(await d.places.spaceFor(placing({ pid: 300 }))).toBeNull();
    await d.elsewhere.go(2, d.ctx);
    expect(await d.places.spaceFor(placing({ pid: 300 }))).toBe(2);
    expect(await d.places.spaceFor(placing({ pid: 400 }))).toBeNull();
  });
});
