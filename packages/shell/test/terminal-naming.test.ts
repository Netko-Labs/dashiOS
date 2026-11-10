import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineArgs, integrationDir, splitCommand } from "../apps/terminal/lib/engine.ts";
import { commandName, folderName, localFolder, type Naming, renamed, tabName, UNNAMED } from "../apps/terminal/lib/naming.ts";
import { EMPTY_SCREEN } from "../apps/terminal/lib/screen.ts";
import { ScreenStore } from "../apps/terminal/lib/store.ts";
import { lineHeightFor, stepFontSize } from "../apps/terminal/lib/views/line.tsx";

const HOME = "/home/alexk";

const after = (...messages: Parameters<typeof renamed>[1][]): Naming => messages.reduce(renamed, UNNAMED);

test("a folder is named by its last part, home as ~", () => {
  expect(folderName("/home/alexk", HOME)).toBe("~");
  expect(folderName("/home/alexk/", HOME)).toBe("~");
  expect(folderName("/home/alexk/Developer/dashiOS", HOME)).toBe("dashiOS");
  expect(folderName("/", HOME)).toBe("/");
  expect(folderName("/tmp", undefined)).toBe("tmp");
});

test("a tab is named by its folder at the prompt and its command while it runs", () => {
  expect(tabName(UNNAMED, HOME)).toBe("Terminal");
  const atPrompt = after({ t: "cwd", path: "/home/alexk/Developer/dashiOS", host: "dashi" }, { t: "prompt" });
  expect(tabName(atPrompt, HOME)).toBe("dashiOS");
  const building = renamed(atPrompt, { t: "command", command: "cargo  build\n--release" });
  expect(tabName(building, HOME)).toBe("cargo build --release");
  expect(tabName(renamed(building, { t: "prompt" }), HOME)).toBe("dashiOS");
});

test("a program that names itself while it runs keeps its name; a prompt's title doesn't beat the folder", () => {
  const titledAtPrompt = after({ t: "cwd", path: "/tmp", host: "" }, { t: "prompt" }, { t: "title", title: "alexk@dashi:/tmp" });
  expect(tabName(titledAtPrompt, HOME)).toBe("tmp");
  const vim = after({ t: "cwd", path: "/tmp", host: "" }, { t: "command", command: "vim notes.md" }, { t: "title", title: "notes.md - VIM" });
  expect(tabName(vim, HOME)).toBe("notes.md - VIM");
  // Without the integration: the program's title, as before.
  expect(tabName(after({ t: "title", title: "htop" }), HOME)).toBe("htop");
});

test("a long command line is cut; an empty one falls back to the folder", () => {
  expect(commandName("x".repeat(50))).toHaveLength(40);
  expect(commandName("x".repeat(50)).endsWith("…")).toBe(true);
  expect(tabName(after({ t: "cwd", path: "/srv", host: "" }, { t: "command", command: "" }), HOME)).toBe("srv");
});

test("naming keeps its identity when nothing changes", () => {
  const named = after({ t: "cwd", path: "/tmp", host: "" });
  expect(renamed(named, { t: "cwd", path: "/tmp", host: "" })).toBe(named);
  expect(renamed(named, { t: "prompt" })).toBe(named);
});

test("new tabs open where the front one is, when that folder is on this machine", () => {
  expect(localFolder({ path: "/srv", host: "" }, "dashi")).toBe("/srv");
  expect(localFolder({ path: "/srv", host: "localhost" }, "dashi")).toBe("/srv");
  expect(localFolder({ path: "/srv", host: "Dashi" }, "dashi.local")).toBe("/srv");
  expect(localFolder({ path: "/srv", host: "build-box" }, "dashi")).toBeNull();
  expect(localFolder(undefined, "dashi")).toBeNull();
});

test("dashi-term starts in the folder asked for, else home, with the integration when there is one", () => {
  expect(engineArgs("/t", { cols: 80, rows: 24 }, { cwd: "/srv", integration: "/i" }, HOME)).toEqual([
    "/t",
    "--cols",
    "80",
    "--rows",
    "24",
    "--cwd",
    "/srv",
    "--integration",
    "/i",
  ]);
  expect(engineArgs("/t", { cols: 80, rows: 24 }, {}, HOME)).toEqual(["/t", "--cols", "80", "--rows", "24", "--cwd", HOME]);
  expect(integrationDir({ DASHI_TERMINAL_INTEGRATION: "0" })).toBeNull();
  expect(integrationDir({})?.endsWith("terminal/integration")).toBe(true);
});

test("a command (an app with Terminal=true) runs after --, in place of the shell and its integration", () => {
  expect(engineArgs("/t", { cols: 80, rows: 24 }, { integration: "/i", command: ["htop", "--tree"] }, HOME)).toEqual([
    "/t",
    "--cols",
    "80",
    "--rows",
    "24",
    "--cwd",
    HOME,
    "--",
    "htop",
    "--tree",
  ]);
  // The Terminal's own words before `-e`, the command's after (its own `-e` too): a path in the command is never the Metal host.
  expect(splitCommand(["--host", "/h", "-e", "/usr/bin/htop", "-e", "10"])).toEqual({ own: ["--host", "/h"], command: ["/usr/bin/htop", "-e", "10"] });
  expect(splitCommand(["/h"])).toEqual({ own: ["/h"], command: null });
  expect(splitCommand(["-e"])).toEqual({ own: [], command: null });
});

test("the command reaches the Terminal as Bun runs it (Bun drops a `--` after the script, so it is `-e`)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-terminal-argv-"));
  const script = join(dir, "argv.ts");
  writeFileSync(
    script,
    `import { splitCommand } from ${JSON.stringify(join(import.meta.dir, "../apps/terminal/lib/engine.ts"))};\nconsole.log(JSON.stringify(splitCommand(Bun.argv.slice(2))));\n`,
  );
  try {
    const run = Bun.spawnSync([process.execPath, script, "-e", "/usr/bin/top", "-d", "1"]);
    expect(JSON.parse(run.stdout.toString())).toEqual({ own: [], command: ["/usr/bin/top", "-d", "1"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the face steps through its sizes and stops at the ends", () => {
  expect(stepFontSize(13, 1)).toBe(14);
  expect(stepFontSize(13, -1)).toBe(12);
  expect(stepFontSize(9, -1)).toBe(9);
  expect(stepFontSize(32, 1)).toBe(32);
  expect(stepFontSize(15, 1)).toBe(18);
  expect(lineHeightFor(13)).toBe(18);
});

test("the screen store tells a tab's listeners only about that tab, and only about change", () => {
  const store = new ScreenStore();
  let heard = 0;
  const stop = store.subscribe(1, () => heard++);
  store.update(2, (screen) => ({ ...screen, cols: 4 }));
  store.update(1, (screen) => screen);
  expect(heard).toBe(0);
  store.update(1, (screen) => ({ ...screen, cols: 4 }));
  expect(heard).toBe(1);
  expect(store.get(1).cols).toBe(4);
  stop();
  store.update(1, (screen) => ({ ...screen, cols: 5 }));
  expect(heard).toBe(1);
  store.delete(1);
  expect(store.get(1)).toBe(EMPTY_SCREEN);
});
