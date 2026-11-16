import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCall } from "../src/agents/index.ts";
import {
  type AgentPolicy,
  type Exec,
  moveForAgent,
  placeForAgent,
  readTextForAgent,
  renameForAgent,
  secretReason,
  writeTextForAgent,
} from "../src/shared/files/index.ts";

let home = "";
let policy: AgentPolicy;
const trashed: string[] = [];
/** `gio trash`, made up: the file goes to a Trash folder of the test's. */
const run: Exec = async (command) => {
  const path = command.at(-1) ?? "";
  trashed.push(path);
  mkdirSync(join(home, ".trash"), { recursive: true });
  writeFileSync(join(home, ".trash", `${trashed.length}`), readFileSync(path));
  rmSync(path, { recursive: true });
  return { ok: true, code: 0, stdout: "", stderr: "" };
};

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "dashi-home-")));
  policy = { home, user: "alexk", userDirs: [join(home, "Documents")] };
  mkdirSync(join(home, "Documents"));
  trashed.length = 0;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("the one list of secret places", () => {
  test("keys, password stores, browser profiles and secret file names are never reached", () => {
    for (const path of [
      ".ssh/id_ed25519",
      ".config/net.imput.helium/Default/Cookies",
      ".mozilla/firefox/x/logins.json",
      "code/app/.env",
      "code/app/.env.local",
      "a/server.pem",
      ".netrc",
      "x/credentials.json",
      ".bash_history",
    ]) {
      expect(secretReason(join(home, path), home)).not.toBeNull();
    }
    for (const path of ["Documents/notes.md", "code/app/README.md", "code/app/env.ts", "Downloads/report.pdf"])
      expect(secretReason(join(home, path), home)).toBeNull();
  });

  test("a path is placed under home, existing or new; outside, secret or with no folder it is refused", async () => {
    expect(await placeForAgent("~/Documents/new.md", policy)).toEqual({ ok: true, path: join(home, "Documents/new.md"), exists: false, kind: null });
    expect(await placeForAgent("/etc/passwd", policy)).toMatchObject({ ok: false });
    expect(await placeForAgent("~/nowhere/x.md", policy)).toMatchObject({ ok: false, error: expect.stringContaining("no folder") });
    expect(await placeForAgent("~/Documents/.env", policy)).toMatchObject({ ok: false, error: expect.stringContaining(".env") });
  });
});

describe("reading a text file", () => {
  test("a line range, cut by characters, says where to go on", async () => {
    writeFileSync(join(home, "Documents/log.txt"), Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n"));
    const first = await readTextForAgent("~/Documents/log.txt", { from: 1, count: 10, maxChars: 20_000 }, policy);
    expect(first).toMatchObject({ from: 1, to: 10, lines: 100, next: 11, kind: "text" });
    const cut = await readTextForAgent("~/Documents/log.txt", { from: 95, count: null, maxChars: 1000 }, policy);
    expect(cut).toMatchObject({ from: 95, to: 100, next: null, text: "line 95\nline 96\nline 97\nline 98\nline 99\nline 100" });
  });

  test("a folder, a binary file and a secret are refused in words", async () => {
    writeFileSync(join(home, "Documents/pic.bin"), new Uint8Array([0, 1, 2, 0, 255]));
    expect(await readTextForAgent("~/Documents", { from: 1, count: null, maxChars: 1000 }, policy)).toMatchObject({ error: expect.stringContaining("folder") });
    expect(await readTextForAgent("~/Documents/pic.bin", { from: 1, count: null, maxChars: 1000 }, policy)).toMatchObject({
      error: expect.stringContaining("isn't text"),
    });
    mkdirSync(join(home, ".ssh"));
    writeFileSync(join(home, ".ssh/config"), "Host x");
    expect(await readTextForAgent("~/.ssh/config", { from: 1, count: null, maxChars: 1000 }, policy)).toMatchObject({
      error: expect.stringContaining("secrets"),
    });
  });
});

describe("writing, moving, copying, renaming", () => {
  test("a file there is never replaced unless asked, and then the old one goes to the Trash", async () => {
    expect(await writeTextForAgent("~/Documents/a.md", "one", "create", policy, run)).toMatchObject({ created: true, trashed: false });
    expect(await writeTextForAgent("~/Documents/a.md", "two", "create", policy, run)).toMatchObject({ error: expect.stringContaining("replace: true") });
    expect(await writeTextForAgent("~/Documents/a.md", "two", "replace", policy, run)).toMatchObject({ created: false, trashed: true });
    expect(readFileSync(join(home, "Documents/a.md"), "utf8")).toBe("two");
    expect(readFileSync(join(home, ".trash/1"), "utf8")).toBe("one");
    await writeTextForAgent("~/Documents/a.md", "\nthree", "append", policy, run);
    expect(readFileSync(join(home, "Documents/a.md"), "utf8")).toBe("two\nthree");
  });

  test("move into a folder or to a new path; a taken name needs replace; standard folders stay", async () => {
    writeFileSync(join(home, "a.txt"), "a");
    mkdirSync(join(home, "Archive"));
    expect(await moveForAgent("move", "~/a.txt", "~/Archive", false, policy, run)).toEqual({
      from: join(home, "a.txt"),
      to: join(home, "Archive/a.txt"),
      trashed: false,
    });
    writeFileSync(join(home, "b.txt"), "b");
    expect(await moveForAgent("copy", "~/b.txt", "~/Archive/a.txt", false, policy, run)).toMatchObject({ error: expect.stringContaining("already there") });
    expect(await moveForAgent("copy", "~/b.txt", "~/Archive/a.txt", true, policy, run)).toMatchObject({ trashed: true });
    expect(readFileSync(join(home, "Archive/a.txt"), "utf8")).toBe("b");
    expect(existsSync(join(home, "b.txt"))).toBe(true);
    expect(await moveForAgent("move", "~/Documents", "~/Archive", false, policy, run)).toMatchObject({ error: expect.stringContaining("standard folders") });
    expect(await renameForAgent("~/b.txt", "c.txt", false, policy, run)).toEqual({ from: join(home, "b.txt"), to: join(home, "c.txt"), trashed: false });
    expect(await renameForAgent("~/c.txt", "a/b", false, policy, run)).toMatchObject({ error: expect.any(String) });
  });

  test("the tools' arguments", () => {
    expect(parseCall({ name: "write_text_file", arguments: { path: "~/x.md", text: "hi", append: true } })).toEqual({
      name: "write_text_file",
      path: "~/x.md",
      text: "hi",
      mode: "append",
    });
    expect(parseCall({ name: "read_text_file", arguments: { path: "~/x.md" } })).toEqual({
      name: "read_text_file",
      path: "~/x.md",
      from: 1,
      count: null,
      maxChars: 20_000,
    });
    expect(parseCall({ name: "rename_file", arguments: { path: "~/x.md", name: "y.md" } })).toEqual({
      name: "rename_file",
      path: "~/x.md",
      newName: "y.md",
      replace: false,
    });
  });
});
