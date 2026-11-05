import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { personTitle } from "../src/actions/confirm-sheet.tsx";
import { addressText, copyAddress } from "../src/actions/copy.ts";
import { parseLinkRequest, replyLine, serveLinks } from "../src/actions/links.ts";
import { linkDecision, type RunDeps, runAction } from "../src/actions/run.ts";
import { type ActionDef, ok, ready } from "../src/actions/types.ts";
import { TOOL_ACTIONS } from "../src/agents/tools/index.ts";

function action(extra: Partial<ActionDef> = {}): ActionDef & { ran: number } {
  const made = {
    ran: 0,
    address: "dashi://test/thing",
    title: "Thing",
    description: "",
    keywords: { en: [] },
    kind: "run" as const,
    properties: { value: { type: "boolean" } },
    scope: null,
    readOnly: false,
    destructive: false,
    who: "person" as const,
    source: "test",
    check(args: Record<string, unknown>) {
      if (args.value !== undefined && typeof args.value !== "boolean") return { ok: false as const, error: "`value` must be true or false." };
      return ready(async () => {
        made.ran++;
        return ok("Done.");
      });
    },
    ...extra,
  };
  return made;
}

function deps(extra: Partial<RunDeps> = {}) {
  const log: Array<{ tool: string; outcome: string }> = [];
  const revealed: unknown[] = [];
  const asked: string[] = [];
  const given: RunDeps = {
    context: (window) => ({ window }),
    log: (entry) => void log.push(entry),
    reveal: (place) => void revealed.push(place),
    confirmLink: async (each) => {
      asked.push(each.address);
      return false;
    },
    ...extra,
  };
  return { given, log, revealed, asked };
}

describe("running an action for the person", () => {
  test("runs as the person and is logged as “you” would see it: the address and how it went", async () => {
    const thing = action();
    const { given, log } = deps();
    expect(await runAction(thing, {}, "person", given)).toEqual({ ok: true, text: "Done." });
    expect(thing.ran).toBe(1);
    expect(log).toEqual([{ tool: "dashi://test/thing", outcome: "ok" }]);
  });

  test("arguments that don't fit say so and run nothing", async () => {
    const thing = action();
    const { given, log } = deps();
    expect(await runAction(thing, { value: "yes" }, "person", given)).toEqual({ ok: false, error: "`value` must be true or false." });
    expect(thing.ran).toBe(0);
    expect(log).toEqual([]);
  });

  test("an agents-only tool is not the person's", async () => {
    const screenshot = TOOL_ACTIONS.find((each) => each.tool === "screenshot");
    if (!screenshot) throw new Error("no screenshot tool");
    expect(await runAction(screenshot, {}, "person", deps().given)).toEqual({ ok: false, error: "Only agents use this." });
  });

  test("a failure is caught, logged, and said", async () => {
    const thing = action({ check: () => ready(async () => Promise.reject(new Error("boom"))) });
    const { given, log } = deps();
    expect(await runAction(thing, {}, "person", given)).toEqual({ ok: false, error: "Thing failed: boom" });
    expect(log).toEqual([{ tool: "dashi://test/thing", outcome: "error" }]);
  });

  test("a tool the person runs asks on their sheet; No is Cancelled", async () => {
    const trash = TOOL_ACTIONS.find((each) => each.tool === "trash_file");
    const checked = trash?.check({ path: "/home/alexk/notes.txt" });
    if (!checked?.ok) throw new Error("trash_file did not check");
    const outcome = await checked.run({ window: null, tool: async () => ({ content: [{ type: "text", text: "Cancelled." }], isError: true }) });
    expect(outcome).toEqual({ ok: false, error: "Cancelled." });
    expect(personTitle("force “Notes” to quit")).toBe("Force “Notes” to quit?");
    expect(personTitle("")).toBe("Go ahead?");
  });
});

describe("a link from outside", () => {
  test("never runs a destructive action: the launcher opens it filled in, or a sheet asks", async () => {
    const thing = action({ destructive: true });
    const presented: unknown[] = [];
    const withLauncher = deps({ present: (each, args) => presented.push([each.address, args]) > 0 });
    expect(await runAction(thing, { value: true }, "link", withLauncher.given)).toEqual({ ok: true, text: "Thing is open, waiting for you." });
    expect(presented).toEqual([["dashi://test/thing", { value: true }]]);
    expect(thing.ran).toBe(0);
    expect(withLauncher.log).toEqual([{ tool: "dashi://test/thing", outcome: "opened" }]);

    const sheet = deps();
    expect(await runAction(thing, {}, "link", sheet.given)).toEqual({ ok: false, error: "Cancelled." });
    expect(sheet.asked).toEqual(["dashi://test/thing"]);
    expect(thing.ran).toBe(0);

    const yes = deps({ confirmLink: async () => true });
    expect(await runAction(thing, {}, "link", yes.given)).toEqual({ ok: true, text: "Done." });
    expect(thing.ran).toBe(1);
  });

  test("a link with arguments that don't fit opens nothing", async () => {
    const thing = action({ destructive: true });
    const { given, asked } = deps({ present: () => true });
    expect(await runAction(thing, { value: "no" }, "link", given)).toEqual({ ok: false, error: "`value` must be true or false." });
    expect(asked).toEqual([]);
  });

  test("runs what isn't destructive; an action that asks every time asks on its own sheet", async () => {
    expect(linkDecision(action(), {})).toBe("run");
    expect(linkDecision(action({ destructive: true, asksEveryTime: true }), {})).toBe("run");
    expect(linkDecision(action({ destructive: true }), {})).toBe("present");
  });

  test("a settings address opens Settings at its row; with a value it sets it", async () => {
    const row = action({ place: { pane: "appearance", row: "dark-mode" } });
    const opened = deps();
    expect(await runAction(row, {}, "link", opened.given)).toEqual({ ok: true, text: "Thing is open in System Settings." });
    expect(opened.revealed).toEqual([{ pane: "appearance", row: "dark-mode" }]);
    expect(row.ran).toBe(0);
    expect(linkDecision(row, { value: true })).toBe("run");
    expect(await runAction(row, { value: true }, "link", deps().given)).toEqual({ ok: true, text: "Done." });
  });
});

describe("the links socket", () => {
  let dir = "";
  let stop: () => void = () => {};
  afterEach(() => {
    stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("checks the one request line", () => {
    expect(parseLinkRequest('{"open":"dashi://settings/sound"}')).toEqual({ url: "dashi://settings/sound" });
    expect(parseLinkRequest("nope")).toEqual({ error: "The request is not JSON." });
    expect(parseLinkRequest('{"open":"dashi://x","run":true}')).toEqual({ error: 'The request is {"open": "dashi://…"}.' });
    expect(parseLinkRequest(`{"open":"${"a".repeat(3000)}"}`)).toEqual({ error: "The link is too long." });
    expect(replyLine({ ok: false, error: "No." })).toBe('{"ok":false,"error":"No."}\n');
  });

  const ask = async (path: string, line: string): Promise<string> => {
    let answer = "";
    const done = Promise.withResolvers<void>();
    const socket = await Bun.connect({
      unix: path,
      socket: {
        data: (_socket, data) => {
          answer += new TextDecoder().decode(data);
        },
        close: () => done.resolve(),
        error: () => done.resolve(),
      },
    });
    socket.write(line);
    await done.promise;
    return answer;
  };

  test("answers a link from this user, and refuses anyone it can't tell", async () => {
    dir = mkdtempSync(join(tmpdir(), "dashi-links-"));
    const path = join(dir, "dashi-links.sock");
    const opened: string[] = [];
    let peer: number | null = 1234;
    stop = serveLinks({
      path,
      peer: () => peer,
      open: async (url) => {
        opened.push(url);
        return { ok: true, text: "Sound is open in System Settings." };
      },
    });
    expect(await ask(path, '{"open":"dashi://settings/sound"}\n')).toBe('{"ok":true,"text":"Sound is open in System Settings."}\n');
    expect(await ask(path, "garbage\n")).toBe('{"ok":false,"error":"The request is not JSON."}\n');
    expect(opened).toEqual(["dashi://settings/sound"]);
    peer = null;
    expect(await ask(path, '{"open":"dashi://settings/sound"}\n')).toBe("");
    expect(opened).toHaveLength(1);
  });
});

describe("Copy Address", () => {
  test("puts the address, with its arguments, on the clipboard", async () => {
    const written: string[] = [];
    const clipboard = { canWrite: true, readText: async () => null, writeText: async (text: string) => written.push(text) > 0 };
    expect(addressText({ address: "dashi://settings/appearance/dark-mode" })).toBe("dashi://settings/appearance/dark-mode");
    expect(await copyAddress({ address: "dashi://settings/mouse/scrolling-speed" }, { value: 2 }, clipboard)).toBe(true);
    expect(written).toEqual(["dashi://settings/mouse/scrolling-speed?value=2"]);
  });
});
