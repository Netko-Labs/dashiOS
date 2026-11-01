/**
 * Telling agents apart when they run under an interpreter. A Node, Bun, or
 * Python agent's executable is the interpreter, so grants keyed by it would
 * cover every program that interpreter runs. For those the agent is what the
 * interpreter was told to run: the script, module, or inline code on its
 * command line.
 *
 * `/proc/<pid>/cmdline` is data from another process and is parsed as such:
 * NUL-separated, bounded in size and count, and anything odd (a title the
 * process rewrote, control characters, an endless path) means "no script
 * found", never a guess.
 */

import { resolve } from "node:path";

/** Bytes of cmdline read; a longer one is cut at its last whole argument. */
export const MAX_CMDLINE = 64 * 1024;
/** Arguments looked at; the script is among the first few. */
const MAX_ARGS = 256;
const MAX_PATH = 4096;
const MAX_MODULE = 256;

/** How an interpreter's command line spells what it runs. */
export interface Interpreter {
  family: "node" | "bun" | "deno" | "python" | "ruby" | "perl" | "shell";
  /** Arguments after which the next one is inline code. */
  inline: ReadonlySet<string>;
  /** Arguments after which the next one is a module (`python -m`). */
  module: ReadonlySet<string>;
  /** Flags that take their value as the next argument. */
  valued: ReadonlySet<string>;
  /** A leading word that is not the script (`bun run agent.ts`). */
  subcommands: ReadonlySet<string>;
}

const words = (...items: string[]): ReadonlySet<string> => new Set(items);
const none = words();

const INTERPRETERS: Record<Interpreter["family"], Interpreter> = {
  node: {
    family: "node",
    inline: words("-e", "--eval", "-p", "--print"),
    module: none,
    valued: words("-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions", "--env-file", "--input-type"),
    subcommands: none,
  },
  bun: {
    family: "bun",
    inline: words("-e", "--eval", "-p", "--print"),
    module: none,
    valued: words("-r", "--preload", "--cwd", "-c", "--config", "--env-file", "--port"),
    subcommands: words("run", "x"),
  },
  deno: {
    family: "deno",
    inline: words("eval"),
    module: none,
    valued: words("-c", "--config", "--import-map", "--lock", "--cert", "--location"),
    subcommands: words("run"),
  },
  python: { family: "python", inline: words("-c"), module: words("-m"), valued: words("-W", "-X", "-Q"), subcommands: none },
  ruby: { family: "ruby", inline: words("-e"), module: none, valued: words("-r", "-I", "-C"), subcommands: none },
  perl: { family: "perl", inline: words("-e", "-E"), module: none, valued: words("-I"), subcommands: none },
  shell: { family: "shell", inline: words("-c"), module: none, valued: words("-o", "-O", "--rcfile", "--init-file"), subcommands: none },
};

/** Executable names by family; versioned ones (python3.12, ruby3.2) match too. */
const NAMES: ReadonlyArray<[RegExp, Interpreter["family"]]> = [
  [/^node(js)?$/, "node"],
  [/^bun$/, "bun"],
  [/^deno$/, "deno"],
  [/^python[\d.]*$/, "python"],
  [/^ruby[\d.]*$/, "ruby"],
  [/^perl[\d.]*$/, "perl"],
  [/^(sh|bash|zsh|dash)$/, "shell"],
];

/** The interpreter an executable name (or path) is, if it is one. */
export function interpreterOf(executable: string): Interpreter | null {
  // A binary replaced while running reads "/usr/bin/node (deleted)".
  const name = (executable.split("/").pop() ?? "").replace(/ \(deleted\)$/, "");
  const found = NAMES.find(([pattern]) => pattern.test(name));
  return found ? INTERPRETERS[found[1]] : null;
}

/** A command line as arguments, or null when it isn't one. */
export function parseCmdline(bytes: Uint8Array, limit = MAX_CMDLINE): string[] | null {
  if (bytes.length === 0) return null;
  let end = bytes.length;
  if (bytes[end - 1] !== 0) {
    // The kernel ends every argument with NUL. Only a read cut short may lack
    // one; anything else is a process that rewrote its title.
    if (bytes.length < limit) return null;
    end = bytes.lastIndexOf(0) + 1;
    if (end === 0) return null;
  }
  const args = new TextDecoder().decode(bytes.subarray(0, end - 1)).split("\0");
  return args.slice(0, MAX_ARGS);
}

export type Invocation =
  | { kind: "file"; path: string }
  | { kind: "module"; name: string; cwd: string }
  | { kind: "code"; digest: string };

const hasControl = (value: string) => /\p{Cc}/u.test(value);

function file(path: string | undefined, cwd: string | null): Invocation | null {
  if (!path || path.length > MAX_PATH || hasControl(path)) return null;
  if (path.startsWith("/")) return { kind: "file", path: resolve(path) };
  // A relative script means the directory the process runs in.
  return cwd ? { kind: "file", path: resolve(cwd, path) } : null;
}

/**
 * What `args` (argv, program first) asks `interpreter` to run, with `cwd` to
 * resolve relative paths against; null when it is not clear (a REPL, a
 * script on stdin, an unreadable command line).
 */
export function findInvocation(interpreter: Interpreter, args: readonly string[], cwd: string | null): Invocation | null {
  const directory = cwd?.startsWith("/") ? cwd : null;
  let skipped = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") return file(args[i + 1], directory);
    if (arg === "-") return null;
    if (interpreter.inline.has(arg)) {
      const code = args[i + 1];
      return code === undefined ? null : { kind: "code", digest: new Bun.CryptoHasher("sha256").update(code).digest("hex").slice(0, 16) };
    }
    if (interpreter.module.has(arg)) {
      const name = args[i + 1];
      if (!name || name.length > MAX_MODULE || hasControl(name) || !directory) return null;
      return { kind: "module", name, cwd: directory };
    }
    if (interpreter.valued.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    if (!skipped && interpreter.subcommands.has(arg)) {
      skipped = true;
      continue;
    }
    return file(arg, directory);
  }
  return null;
}

/** What stored grants are keyed by: the executable and what it runs. */
export function invocationKey(executable: string, invocation: Invocation): string {
  switch (invocation.kind) {
    case "file":
      return `${executable} ${invocation.path}`;
    case "module":
      return `${executable} -m ${invocation.name} in ${invocation.cwd}`;
    case "code":
      return `${executable} -e sha256:${invocation.digest}`;
  }
}

/** What the sheet says it runs; `shorten` abbreviates paths (the home directory). */
export function invocationLabel(invocation: Invocation, shorten: (path: string) => string): string {
  switch (invocation.kind) {
    case "file":
      return shorten(invocation.path);
    case "module":
      return `-m ${invocation.name}`;
    case "code":
      return "(inline code)";
  }
}
