import { describe, expect, test } from "bun:test";
import { linksEntry } from "../src/actions/entry.ts";
import { chordGlyphs, keyFor } from "../src/actions/keys.ts";
import { linkDecision } from "../src/actions/run.ts";
import { type CaptureKind, commandActions } from "../src/actions/sources/commands.ts";
import type { ActionDef } from "../src/actions/types.ts";
import { KEYMAP } from "../src/keymap.ts";
import type { MenuAction } from "../src/menus/model.ts";
import { desktopFields } from "../src/shared/apps/index.ts";
import { type Requests, runBinding, type ShellActions } from "../src/shortcuts.ts";
import { run } from "./support/actions-sources.ts";
import { fakeClockEachTest } from "./support/time.ts";

fakeClockEachTest();

describe("Dashi's own commands", () => {
  test("run the Dashi menu's actions; ending the session asks on its own sheet", async () => {
    const ran: MenuAction[] = [];
    const actions = commandActions(async (action) => void ran.push(action), KEYMAP);
    const byId = (id: string) => actions.find((action) => action.address === `dashi://dashi/${id}`);
    expect(await run(byId("lock-screen"))).toEqual({ ok: true, text: "The screen is locked." });
    expect(await run(byId("restart"))).toEqual({ ok: true, text: "Asking about restarting." });
    expect(ran).toEqual([{ kind: "lock" }, { kind: "power", what: "restart" }]);
    expect(byId("restart")).toMatchObject({ destructive: true, asksEveryTime: true });
    expect(byId("sleep")).toMatchObject({ destructive: false });
    expect(byId("lock-screen")?.shortcut).toBe("⌃❖Q");
    expect(actions.map((action) => action.address)).toContain("dashi://dashi/log-out");
  });

  test("the screenshots are ⇧❖3 ⇧❖4 ⇧❖5's own addresses, run on the window focused when asked", async () => {
    const captured: [CaptureKind, number | null][] = [];
    const actions = commandActions(
      async () => {},
      KEYMAP,
      async (what, window) => void captured.push([what, window]),
    );
    const byId = (id: string) => actions.find((action) => action.address === `dashi://dashi/${id}`);
    // The keymap binds the addresses, and their rows show its keys.
    const bound = (chord: string) => KEYMAP.rules.find((rule) => rule.when === chord)?.bind;
    expect([bound("super+shift+3"), bound("super+shift+4"), bound("super+shift+5")]).toEqual([
      "dashi://dashi/screenshot",
      "dashi://dashi/screenshot-area",
      "dashi://dashi/capture",
    ]);
    expect(byId("capture")).toMatchObject({ title: "Screenshot…", shortcut: "⇧❖5", kind: "open", source: "dashi" });
    expect(byId("screenshot")).toMatchObject({ title: "Screenshot of the Screen", shortcut: "⇧❖3" });
    expect(byId("screenshot-area")).toMatchObject({ title: "Screenshot of an Area…", shortcut: "⇧❖4" });
    expect(await run(byId("capture"), {}, { window: 7 })).toEqual({ ok: true, text: "The screenshot toolbar is open." });
    await run(byId("screenshot"));
    await run(byId("screenshot-area"), {}, { window: 3 });
    expect(captured).toEqual([
      ["toolbar", 7],
      ["screen", null],
      ["area", 3],
    ]);
    // A link never takes a picture of the screen by itself: it is opened for the person. The toolbar and the area wait for them anyway.
    expect(linkDecision(byId("screenshot") as ActionDef, {})).toBe("present");
    // …without looking dangerous: it isn't destructive, so its button isn't red.
    expect(byId("screenshot")).toMatchObject({ destructive: false, linkOpens: true });
    expect(linkDecision(byId("capture") as ActionDef, {})).toBe("run");
    expect(linkDecision(byId("screenshot-area") as ActionDef, {})).toBe("run");
    // Without a way to capture (no compositor) there are no screenshot rows.
    expect(commandActions(async () => {}, KEYMAP).some((action) => action.address.includes("screenshot"))).toBe(false);
  });

  test("a screenshot key reaches the registry as its address, not a name of its own", async () => {
    const asked: [string, number | null][] = [];
    const actions = {
      hardware: { run: async () => false },
      runAddress: async (address: string, window: number | null) => void asked.push([address, window]),
    } as unknown as ShellActions;
    const compositor = { request: async () => ({}), windows: async () => [] } as unknown as Requests;
    await runBinding("dashi://dashi/capture", 5, compositor, actions);
    expect(asked).toEqual([["dashi://dashi/capture", 5]]);
  });
});

describe("keys and the scheme's desktop entry", () => {
  test("a rule's chord in Dashi's notation", () => {
    expect(chordGlyphs("super+ctrl+Left")).toBe("⌃❖←");
    expect(chordGlyphs("super+ctrl+Return|KP_Enter")).toBe("⌃❖↩");
    expect(chordGlyphs("super+alt+Escape")).toBe("⌥❖Esc");
    expect(chordGlyphs("super+letter")).toBeNull();
    expect(keyFor("dashi://window/arrange/right", KEYMAP)).toBe("⌃❖→");
    expect(keyFor("dashi://nothing", KEYMAP)).toBeUndefined();
  });

  test("the x-scheme-handler/dashi entry runs dashi-open with the link", () => {
    const entry = linksEntry({ bun: "/usr/libexec/dashi/bin/bun", root: "/usr/share/dashi/shell/" });
    expect(entry?.file).toBe("dev.dashi.links.desktop");
    const fields = desktopFields(entry?.text ?? "");
    expect(fields.get("Exec")).toBe("/usr/libexec/dashi/bin/bun /usr/share/dashi/shell/bin/dashi-open.ts %u");
    expect(fields.get("MimeType")).toBe("x-scheme-handler/dashi;");
    expect(fields.get("NoDisplay")).toBe("true");
    expect(fields.get("X-Dashi-Managed")).toBe("true");
    expect(linksEntry({ bun: "/bin/bun\n", root: "/x/" })).toBeNull();
  });
});
