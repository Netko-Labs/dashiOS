/**
 * Your own commands (docs/actions.md, "Your own scripts"): executables in
 * `~/.local/share/dashi/commands/`, each with a few header lines that say
 * what it is, in any language that has comments:
 *
 *   #!/bin/sh
 *   # @dashi.title Say hello
 *   # @dashi.keywords greet, hi
 *   # @dashi.argument name Name
 *   # @dashi.output text
 *   echo "Hello, $1"
 *
 * Each is an action at `dashi://script/<file name>`, its row marked "Script".
 * It runs as you, as a transient user unit (`systemd-run --user`, with
 * `RuntimeMaxSec=` and the applets' CPU, memory and priority limits) so one
 * that runs away is stopped, with your arguments in order. What it prints is
 * its answer (`@dashi.output`): `text`, a row in the launcher that Return
 * copies (the default); `copy`, put on the clipboard; `open`, a web page or a
 * `dashi://` address opened; `silent`, nothing. A script is your own code, so
 * a link from outside only opens it, never runs it (`destructive`).
 *
 * Only files that are yours, executable, and writable by you alone are
 * read; the folder is watched, so a new one is there at once.
 */

import { type Dirent, mkdirSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { UNIT_LIMITS } from "../../applets/launcher.ts";
import { formatAddress, isSegment } from "../address.ts";
import { type ActionDef, type ActionSource, type Args, failed, invalid, type Outcome, ok, ready } from "../types.ts";

export const SCRIPT_OUTPUTS = ["text", "copy", "open", "silent"] as const;
export type ScriptOutput = (typeof SCRIPT_OUTPUTS)[number];

export interface ScriptArg {
  name: string;
  title: string;
  required: boolean;
}

export interface ScriptHeader {
  title: string;
  keywords: string[];
  args: ScriptArg[];
  output: ScriptOutput;
}

export const SCRIPT_LIMITS = {
  /** Header lines are looked for in the first this many lines. */
  headerLines: 40,
  /** Bytes read of a file, for its header; and the largest file read at all. */
  headerBytes: 8 * 1024,
  fileBytes: 1024 * 1024,
  scripts: 200,
  args: 4,
  title: 60,
  /** How long one may run (`RuntimeMaxSec=`). */
  runSeconds: 30,
  /** What is kept of its output. */
  output: 16 * 1024,
} as const;

const HEADER = /^\s*(?:#|\/\/|--|;|%|')\s*@dashi\.([a-z]+)\s+(.+?)\s*$/;
const ARG = /^([a-z_][a-z0-9_]{0,31})(\?)?(?:\s+(.+))?$/;

/** A script's header, or null when it has none (no `@dashi.title`) or says something it can't. */
export function parseScriptHeader(text: string): ScriptHeader | null {
  let title: string | null = null;
  const keywords: string[] = [];
  const args: ScriptArg[] = [];
  let output: ScriptOutput = "text";
  for (const line of text.split("\n").slice(0, SCRIPT_LIMITS.headerLines)) {
    const match = HEADER.exec(line);
    if (!match) continue;
    const [, key, value = ""] = match;
    // Control characters (and bidi overrides) never reach a row.
    if (/[\p{Cc}‪-‮⁦-⁩]/u.test(value)) return null;
    switch (key) {
      case "title":
        title = value.slice(0, SCRIPT_LIMITS.title);
        break;
      case "keywords":
        keywords.push(...value.split(/[,\s]+/).filter((word) => word !== "" && word.length <= 40));
        break;
      case "argument": {
        const arg = ARG.exec(value);
        if (!arg?.[1] || args.length >= SCRIPT_LIMITS.args || args.some((each) => each.name === arg[1])) return null;
        args.push({ name: arg[1], title: (arg[3] ?? arg[1]).slice(0, 40), required: arg[2] !== "?" });
        break;
      }
      case "output": {
        const kind = SCRIPT_OUTPUTS.find((each) => each === value);
        if (!kind) return null;
        output = kind;
        break;
      }
    }
  }
  return title ? { title, keywords: keywords.slice(0, 12), args, output } : null;
}

/** Where your commands live. */
export function scriptsDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_DATA_HOME || join(home, ".local/share"), "dashi/commands");
}

/** What a script prints, as its header says to take it. */
export interface ScriptRun {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ScriptDeps {
  dir: string;
  /** Run `path` with `args` as the person (systemd-run; tests pass their own). */
  run?(path: string, args: readonly string[]): Promise<ScriptRun>;
  copy(text: string): Promise<boolean>;
  open(target: string): Promise<Outcome>;
  /** This user's id: only their own files are read. */
  uid?: number;
}

/** The limits a script's unit runs under (the applets' own, applets/launcher.ts, and a time limit). */
export const SCRIPT_UNIT: readonly string[] = [`RuntimeMaxSec=${SCRIPT_LIMITS.runSeconds}`, ...UNIT_LIMITS];

let runs = 0;

/** Runs a script as a transient user unit, its output piped back; directly where there is no systemd-run. */
export async function runScript(path: string, args: readonly string[]): Promise<ScriptRun> {
  const unit = `dashi-command-${process.pid}-${++runs}`;
  const argv = Bun.which("systemd-run")
    ? [
        "systemd-run",
        "--user",
        "--quiet",
        "--collect",
        "--pipe",
        "--wait",
        `--unit=${unit}`,
        ...SCRIPT_UNIT.flatMap((each) => ["-p", each]),
        "--",
        path,
        ...args,
      ]
    : [path, ...args];
  const child = Bun.spawn(argv, { cwd: homedir(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const kill = setTimeout(() => child.kill(), (SCRIPT_LIMITS.runSeconds + 5) * 1000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout: stdout.slice(0, SCRIPT_LIMITS.output), stderr: stderr.slice(-2000) };
  } finally {
    clearTimeout(kill);
  }
}

/** What a run came to, by the header's `output`. */
export async function scriptOutcome(header: ScriptHeader, result: ScriptRun, deps: Pick<ScriptDeps, "copy" | "open">): Promise<Outcome> {
  if (result.code !== 0) {
    const last = result.stderr.trim().split("\n").at(-1)?.trim();
    return failed(last ? `${header.title}: ${last}` : `${header.title} stopped with code ${result.code}.`);
  }
  const text = result.stdout.trim();
  switch (header.output) {
    case "silent":
      return ok(`${header.title} is done.`);
    case "copy":
      if (text === "") return failed(`${header.title} printed nothing to copy.`);
      return (await deps.copy(text)) ? ok("Copied") : failed("Couldn't copy");
    case "open": {
      const target = text.split("\n")[0]?.trim() ?? "";
      return /^(https?|dashi):\/\/\S+$/.test(target) ? deps.open(target) : failed(`${header.title} printed no address to open.`);
    }
    case "text":
      return text === "" ? ok(`${header.title} is done.`) : { ok: true, text, show: { kind: "text", text } };
  }
}

/** Whether a folder entry is a script Dashi may read: a regular file of yours, executable, writable by you alone, not too large. */
function isRunnable(path: string, uid: number | undefined): boolean {
  try {
    const info = statSync(path);
    return (
      info.isFile() && (uid === undefined || info.uid === uid) && (info.mode & 0o100) !== 0 && (info.mode & 0o022) === 0 && info.size <= SCRIPT_LIMITS.fileBytes
    );
  } catch {
    return false;
  }
}

function readHead(path: string): string {
  try {
    return readFileSync(path).subarray(0, SCRIPT_LIMITS.headerBytes).toString("utf8");
  } catch {
    return "";
  }
}

/** One script as an action. */
export function scriptAction(file: string, path: string, header: ScriptHeader, deps: Pick<ScriptDeps, "run" | "copy" | "open">): ActionDef {
  const run = deps.run ?? runScript;
  return {
    address: formatAddress(["script", file]),
    title: header.title,
    description: "",
    keywords: { en: [...header.keywords, "script"] },
    kind: "run",
    properties: Object.fromEntries(header.args.map((arg) => [arg.name, { type: "string", description: arg.title }])),
    ...(header.args.some((arg) => arg.required) ? { required: header.args.filter((arg) => arg.required).map((arg) => arg.name) } : {}),
    scope: null,
    readOnly: false,
    // Your own code: a link opens it for you to run, never runs it.
    destructive: true,
    who: "person",
    source: "scripts",
    from: "Script",
    check: (args: Args) => {
      const stray = Object.keys(args).find((name) => !header.args.some((arg) => arg.name === name));
      if (stray !== undefined) return invalid(`${header.title} takes no “${stray}”.`);
      const values: string[] = [];
      for (const arg of header.args) {
        const value = args[arg.name];
        if (value === undefined || value === "") {
          if (arg.required) return invalid(`${header.title} needs “${arg.title}”.`);
          values.push("");
          continue;
        }
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return invalid(`“${arg.title}” must be text.`);
        values.push(String(value).slice(0, 1000));
      }
      // Trailing empty optional arguments are left off.
      while (values.length > 0 && values.at(-1) === "") values.pop();
      return ready(async () => scriptOutcome(header, await run(path, values), deps));
    },
  };
}

/** Every script in the folder, read again when it changes. */
export class ScriptSource implements ActionSource {
  readonly id = "scripts";
  private current: ActionDef[] = [];
  private readonly listeners = new Set<() => void>();
  private watcher: ReturnType<typeof watch> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ScriptDeps) {}

  actions = (): readonly ActionDef[] => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Read the folder now (made if it isn't there, so it is there to put scripts in), and watch it from here on. */
  start(): this {
    try {
      mkdirSync(this.deps.dir, { recursive: true, mode: 0o700 });
      this.watcher = watch(this.deps.dir, () => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.read(), 200);
      });
    } catch (error) {
      console.error(`dashi-shell: your commands in ${this.deps.dir} aren't watched:`, error instanceof Error ? error.message : error);
      this.watcher = null;
    }
    this.read();
    return this;
  }

  read(): void {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(this.deps.dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    this.current = entries
      .filter((entry) => !entry.name.startsWith(".") && isSegment(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, SCRIPT_LIMITS.scripts)
      .flatMap((entry) => {
        const path = join(this.deps.dir, entry.name);
        if (!isRunnable(path, this.deps.uid)) return [];
        const header = parseScriptHeader(readHead(path));
        return header ? [scriptAction(entry.name, path, header, this.deps)] : [];
      });
    for (const listener of this.listeners) listener();
  }

  close(): void {
    this.watcher?.close();
    if (this.timer) clearTimeout(this.timer);
  }
}
