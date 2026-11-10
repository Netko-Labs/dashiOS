import { describe, expect, test } from "bun:test";
import { type ActionDef, ok, ready } from "../src/actions/types.ts";
import type { Entry } from "../src/entries.ts";
import { withHandoff } from "../src/launcher/handoff-rows.ts";
import { launcherIndex } from "../src/launcher/lib/items.ts";
import { buildSections, type ListInput } from "../src/launcher/lib/rows.ts";
import { commandCore, startsWithCommand } from "../src/launcher/ranking/index.ts";
import type { Section } from "../src/launcher/sections.ts";
import type { HandoffSnapshot } from "../src/launcher/types.ts";
import { spaceFlips } from "../src/launcher/verbs.ts";
import { ENTRIES } from "./ranking-fixture.ts";

/** A Settings row as the registry lists it (settings-app/registry/: look.ts, machine.ts). */
function setting(
  address: string,
  title: string,
  keywords: string[],
  kind: ActionDef["kind"],
  pane: string,
  source: ActionDef["source"] = "settings",
): ActionDef {
  return {
    address,
    title,
    description: "",
    keywords: { en: keywords },
    kind,
    properties: {},
    scope: null,
    readOnly: false,
    destructive: false,
    who: "person",
    source,
    place: { pane, row: address.split("/").pop() as string },
    check: () => ready(async () => ok("Done.")),
  };
}

const ACTIONS: ActionDef[] = [
  setting("dashi://settings/appearance/dark-mode", "Dark Mode", ["dark", "light mode", "theme", "night mode", "auto"], "toggle", "appearance"),
  setting("dashi://settings/sound/output-volume", "Output volume", ["volume", "loudness", "speakers"], "run", "sound"),
  setting("dashi://settings/bluetooth/bluetooth", "Bluetooth", ["bt", "wireless", "headphones", "pairing"], "toggle", "bluetooth", "controls"),
];
const entries: Entry[] = [...ENTRIES, { id: "dev.dashi.calendar", name: "Calendar", icon: "", keywords: ["events", "schedule"] }];
const index = launcherIndex({ entries, actions: ACTIONS });
const ICONS = { calculator: "/calc.svg", files: "/files.svg", software: "/software.svg", command: "/dashi.svg" };

const snapshot: HandoffSnapshot = {
  harnesses: [
    { id: "claude-code", name: "Claude Code", uses: "your Claude subscription", signedIn: true },
    { id: "codex", name: "Codex", uses: "your ChatGPT plan", signedIn: true },
  ],
  runs: [],
};

/** What the launcher lists for `query`, with a harness installed: the sections as main.tsx puts them together. */
function launcher(query: string): Section[] {
  const input: ListInput = { query, entries, recent: [], files: { kind: "none" }, icons: ICONS, index };
  return withHandoff(buildSections(input), { query, allApps: false, snapshot, tabbed: false });
}
const firstRow = (sections: readonly Section[]) => sections[0]?.rows[0];

describe("a short command finds what it names", () => {
  test("the verb in front and the value at the end come off; a task's words don't", () => {
    expect(commandCore("turn on dark mode")).toBe("dark mode");
    expect(commandCore("Turn Dark Mode on")).toBe("dark mode");
    expect(commandCore("set volume to 30")).toBe("volume");
    expect(commandCore("set the volume to 30%")).toBe("volume");
    expect(commandCore("switch off bluetooth.")).toBe("bluetooth");
    expect(commandCore("enable night light")).toBe("night light");
    // Not a command: no verb in front, nothing left, or too much left to be a thing's name.
    expect(commandCore("dark mode")).toBeNull();
    expect(commandCore("turn on")).toBeNull();
    expect(commandCore("find me a hotel in SF next week and add it to my calendar")).toBeNull();
    expect(commandCore("open the invoices from last week and email them")).toBeNull();
  });

  test('"turn on dark mode" finds the setting first, not "Hand it off"', () => {
    const sections = launcher("turn on dark mode");
    expect(firstRow(sections)?.title).toBe("Dark Mode");
    expect(sections.map((section) => section.id)).toContain("handoff");
    expect(sections[0]?.id).not.toBe("handoff");
  });

  test('"dark mode" finds the setting first', () => {
    expect(firstRow(launcher("dark mode"))?.title).toBe("Dark Mode");
  });

  test('"set volume to 30" finds the volume first', () => {
    const sections = launcher("set volume to 30");
    expect(firstRow(sections)?.title).toBe("Output volume");
    expect(sections[0]?.id).not.toBe("handoff");
  });

  test('"switch off bluetooth" finds Bluetooth first', () => {
    expect(firstRow(launcher("switch off bluetooth"))?.title).toBe("Bluetooth");
  });

  test("a real task still hands off first", () => {
    const sections = launcher("find me a hotel in SF next week and add it to my calendar");
    expect(sections[0]?.id).toBe("handoff");
    expect(firstRow(sections)?.title).toBe("Start Claude Code");
    // A task that starts with a command's verb is still a task.
    expect(launcher("turn on dark mode and email alexk the report")[0]?.id).toBe("handoff");
    expect(launcher("book a spinning class at bodytech thursday 7am")[0]?.id).toBe("handoff");
  });

  test("in words that start with a command's verb, Space types a space: it never flips the switch found", () => {
    // Found from "turn on dark" already: Space must not flip Dark Mode under the person's typing (the VM found it did),
    // nor after "turn on dark mode", which may go on "and email alexk the report". Return flips it.
    const found = firstRow(launcher("turn on dark"));
    expect(found?.title).toBe("Dark Mode");
    const row = { ...(found as NonNullable<typeof found>), control: { kind: "switch" as const, on: false } };
    for (const query of ["turn", "turn on", "turn on the", "turn on dark", "turn on dark mode"]) expect(spaceFlips(row, query)).toBe(false);
    // Its name alone still flips on Space, as before.
    expect(spaceFlips(row, "dark mode")).toBe(true);
    expect(startsWithCommand("turn on dark")).toBe(true);
    expect(startsWithCommand("dark mode")).toBe(false);
  });
});
