import { expect, test } from "bun:test";
import { parseArgs } from "../apps/dialog/args.ts";
import { prepare } from "../apps/dialog/cli.ts";
import { parseFileFilter, selectionOutput, selectionRequest } from "../apps/dialog/file-selection.ts";
import { specFrom } from "../apps/dialog/spec.ts";
import { reservedBy } from "../src/app-menus/lib/reserved.ts";
import { isTextShortcut } from "../src/app-menus/shortcut.ts";
import { type Requests, runBinding, type ShellActions } from "../src/shortcuts.ts";
import { fakeCompositor } from "./support/compositor.ts";

// `dashi-dialog --file-selection` is Files' chooser (PA-12), and ❖⌫ reaches Files' Move to Trash.

test("--file-selection draws Files' chooser instead of exiting 255", () => {
  const prepared = prepare(["--file-selection", "--save", "--filename=~/x", "--file-filter=Pictures | *.png *.jpg", "--separator=\\n"]);
  expect("spec" in prepared).toBe(true);
  const result = specFrom(parseArgs(["--file-selection", "--multiple", "--file-filter=*.pdf", "--file-filter=All | *"]));
  if (!("spec" in result) || result.spec.kind !== "file-selection") throw new Error("no file selection");
  expect(result.spec).toMatchObject({ multiple: true, save: false, directory: false, separator: "|", title: "Select a file" });
  expect(result.spec.filters.map((filter) => filter.name)).toEqual(["*.pdf", "All"]);
});

test("--save and --directory are titled for what they choose; --title still wins", () => {
  const title = (...args: string[]): string | undefined => {
    const result = specFrom(parseArgs(["--file-selection", ...args]));
    return "spec" in result ? result.spec.title : undefined;
  };
  expect(title()).toBe("Select a file");
  expect(title("--save")).toBe("Save a file");
  expect(title("--directory")).toBe("Choose a folder");
  expect(title("--save", "--title=Export the report")).toBe("Export the report");
});

test("file filters: a name and patterns, or patterns alone", () => {
  expect(parseFileFilter("Pictures | *.png *.jpg")).toEqual({
    name: "Pictures",
    patterns: [
      { kind: "glob", pattern: "*.png" },
      { kind: "glob", pattern: "*.jpg" },
    ],
  });
  expect(parseFileFilter("*.txt")).toEqual({ name: "*.txt", patterns: [{ kind: "glob", pattern: "*.txt" }] });
  expect(parseFileFilter("Nothing |  ")).toBeNull();
});

test("--filename: a folder to start in, or a file whose folder and name a save starts with", () => {
  const base = { multiple: false, directory: false, save: false, separator: "|", filters: [] };
  expect(selectionRequest("Pick", { ...base, filename: "/srv/data/" }, "/home/alexk")).toMatchObject({
    mode: "open",
    currentFolder: "/srv/data",
    currentName: null,
  });
  expect(selectionRequest("Save", { ...base, save: true, filename: "notes/today.md" }, "/home/alexk")).toMatchObject({
    mode: "save",
    currentFolder: "/home/alexk/notes",
    currentName: "today.md",
  });
  // A save is never several files or a folder.
  expect(selectionRequest("Save", { ...base, save: true, multiple: true, directory: true, filename: null }, "/")).toMatchObject({
    multiple: false,
    directory: false,
  });
  expect(selectionOutput(["/a", "/b"], "|")).toBe("/a|/b\n");
});

test("❖⌫ is the app's Move to Trash when it shows one, else it erases to the line's start; a field keeps it", async () => {
  expect(reservedBy({ key: "BackSpace", shift: false, ctrl: false, alt: false })).toBeNull();
  expect(isTextShortcut("❖⌫")).toBe(true);
  const requests: [string, unknown][] = [];
  const compositor: Requests = fakeCompositor(
    async (name: string, args: unknown) => {
      requests.push([name, args]);
      return {};
    },
    { windows: async () => [] },
  );
  let taken = true;
  const actions = {
    hardware: { run: async () => false },
    appShortcut: async (_window: number, shortcut: string) => taken && shortcut === "❖⌫",
  } as unknown as ShellActions;
  await runBinding("app-erase", 7, compositor, actions);
  expect(requests).toEqual([]);
  taken = false;
  await runBinding("app-erase", 7, compositor, actions);
  expect(requests).toEqual([
    ["send-keys", { window: 7, chord: "shift+Home" }],
    ["send-keys", { window: 7, chord: "BackSpace" }],
  ]);
});
