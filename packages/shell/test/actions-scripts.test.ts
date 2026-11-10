import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScriptHeader, type ScriptRun, ScriptSource, scriptOutcome, scriptsDir } from "../src/actions/scripts.ts";

const HELLO = [
  "#!/bin/sh",
  "# @dashi.title Say hello",
  "# @dashi.keywords greet, hi",
  "# @dashi.argument name Name",
  "# @dashi.argument loud? Loud",
  'echo "Hello, $1"',
].join("\n");

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

test("a script's header: title, keywords, arguments in order, how its output is taken", () => {
  expect(parseScriptHeader(HELLO)).toEqual({
    title: "Say hello",
    keywords: ["greet", "hi"],
    args: [
      { name: "name", title: "Name", required: true },
      { name: "loud", title: "Loud", required: false },
    ],
    output: "text",
  });
  // Any comment marker; the output's kind is one of four.
  expect(parseScriptHeader("// @dashi.title Copy the date\n// @dashi.output copy")).toMatchObject({ title: "Copy the date", output: "copy" });
  expect(parseScriptHeader("# @dashi.title X\n# @dashi.output shout")).toBeNull();
  // No title, no command; an argument twice, or a bad name, is refused.
  expect(parseScriptHeader("#!/bin/sh\necho hi")).toBeNull();
  expect(parseScriptHeader("# @dashi.title X\n# @dashi.argument a\n# @dashi.argument a")).toBeNull();
  expect(parseScriptHeader("# @dashi.title X\n# @dashi.argument A-B")).toBeNull();
  expect(scriptsDir({ XDG_DATA_HOME: "/data" }, "/home/alexk")).toBe("/data/dashi/commands");
  expect(scriptsDir({}, "/home/alexk")).toBe("/home/alexk/.local/share/dashi/commands");
});

test("what a run comes to, by its header", async () => {
  const header = { title: "Say hello", keywords: [], args: [], output: "text" as const };
  const deps = { copy: async () => true, open: async (target: string) => ({ ok: true as const, text: `Opened ${target}` }) };
  const ran = (stdout: string, code = 0, stderr = ""): ScriptRun => ({ code, stdout, stderr });
  expect(await scriptOutcome(header, ran("Hello, Alex\n"), deps)).toEqual({ ok: true, text: "Hello, Alex", show: { kind: "text", text: "Hello, Alex" } });
  expect(await scriptOutcome(header, ran("", 2, "oops\nno such file\n"), deps)).toEqual({ ok: false, error: "Say hello: no such file" });
  expect(await scriptOutcome({ ...header, output: "copy" }, ran("x"), deps)).toEqual({ ok: true, text: "Copied" });
  expect(await scriptOutcome({ ...header, output: "open" }, ran("https://example.com\n"), deps)).toEqual({ ok: true, text: "Opened https://example.com" });
  expect(await scriptOutcome({ ...header, output: "open" }, ran("/etc/passwd"), deps)).toMatchObject({ ok: false });
  expect(await scriptOutcome({ ...header, output: "silent" }, ran("noise"), deps)).toEqual({ ok: true, text: "Say hello is done." });
});

test("the folder: only your executable scripts with a header become actions, run with your words in order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-commands-"));
  dirs.push(dir);
  writeFileSync(join(dir, "hello.sh"), HELLO);
  chmodSync(join(dir, "hello.sh"), 0o755);
  // Not executable, writable by others, no header: none of them.
  writeFileSync(join(dir, "plain.sh"), "# @dashi.title Plain");
  writeFileSync(join(dir, "shared.sh"), "# @dashi.title Shared");
  chmodSync(join(dir, "shared.sh"), 0o777);
  writeFileSync(join(dir, "bare.sh"), "#!/bin/sh\necho hi");
  chmodSync(join(dir, "bare.sh"), 0o755);
  const runs: Array<{ path: string; args: readonly string[] }> = [];
  const source = new ScriptSource({
    dir,
    run: async (path, args) => {
      runs.push({ path, args });
      return { code: 0, stdout: `Hello, ${args[0]}`, stderr: "" };
    },
    copy: async () => true,
    open: async () => ({ ok: true, text: "" }),
  });
  source.read();
  const actions = source.actions();
  expect(actions.map((action) => [action.address, action.title, action.from, action.destructive])).toEqual([
    ["dashi://script/hello.sh", "Say hello", "Script", true],
  ]);
  const [hello] = actions;
  if (!hello) throw new Error("no hello");
  expect(hello.required).toEqual(["name"]);
  expect(hello.check({})).toEqual({ ok: false, error: "Say hello needs “Name”." });
  expect(hello.check({ name: "Alex", when: "now" })).toEqual({ ok: false, error: "Say hello takes no “when”." });
  const checked = hello.check({ name: "Alex" });
  if (!checked.ok) throw new Error(checked.error);
  expect(await checked.run({ window: null })).toEqual({ ok: true, text: "Hello, Alex", show: { kind: "text", text: "Hello, Alex" } });
  // The optional one left off is not passed.
  expect(runs).toEqual([{ path: join(dir, "hello.sh"), args: ["Alex"] }]);
  source.close();
});
