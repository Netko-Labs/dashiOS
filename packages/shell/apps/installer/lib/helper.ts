/**
 * Running dashi-install as root: `pkexec /usr/libexec/dashi/dashi-install
 * --disk … --user …`, an argument list (no shell), the password on its
 * stdin and nowhere else, its stdout read line by line into events. On the
 * live image polkit lets the live user run it without a password
 * (livesys-dashi).
 *
 * Away from the live image (a development run, or `DASHI_INSTALL=dry-run`)
 * it runs with `--dry-run`, without pkexec: the pages can be walked through
 * without erasing anything. That helper is the checkout's when there is one.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LineSplitter } from "../../src/shared/io/index.ts";

export const HELPER_PATH = "/usr/libexec/dashi/dashi-install";
/** spin/dashi-live's copy in a checkout, from packages/shell/apps/installer. */
const CHECKOUT_HELPER = join(import.meta.dir, "../../../../spin/dashi-live/usr/libexec/dashi/dashi-install");

/** dashi-install's steps, in order. */
export const STEPS = ["check", "partition", "copy", "configure", "account", "bootloader", "finish"] as const;
export type Step = (typeof STEPS)[number];
export const isStep = (value: unknown): value is Step => typeof value === "string" && (STEPS as readonly string[]).includes(value);

export type InstallEvent =
  | { event: "step"; step: Step }
  | { event: "progress"; step: Step; fraction: number }
  | { event: "failed"; step: Step; message: string }
  | { event: "finished"; ok: boolean };

/** One line of dashi-install's stdout, or null for anything else. */
export function parseEvent(line: string): InstallEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const event = value as Record<string, unknown>;
  switch (event.event) {
    case "step":
      return isStep(event.step) ? { event: "step", step: event.step } : null;
    case "progress":
      return isStep(event.step) && typeof event.fraction === "number" && Number.isFinite(event.fraction)
        ? { event: "progress", step: event.step, fraction: Math.min(Math.max(event.fraction, 0), 1) }
        : null;
    case "failed":
      return isStep(event.step) ? { event: "failed", step: event.step, message: typeof event.message === "string" ? event.message : "" } : null;
    case "finished":
      return typeof event.ok === "boolean" ? { event: "finished", ok: event.ok } : null;
    default:
      return null;
  }
}

export interface InstallChoice {
  disk: string;
  user: string;
  fullName: string;
  hostname: string;
  nvidia: boolean;
}

/** The arguments after the helper's path (the password is not one of them). */
export function installArgs(choice: InstallChoice): string[] {
  return [
    "--disk",
    choice.disk,
    "--user",
    choice.user,
    "--full-name",
    choice.fullName,
    "--hostname",
    choice.hostname,
    "--nvidia",
    choice.nvidia ? "yes" : "no",
    "--kernel",
    "auto",
  ];
}

type Env = Readonly<Record<string, string | undefined>>;

/** Booted from the live image (`rd.live.image`), where the installer is real. */
export function isLiveBoot(cmdline: string): boolean {
  return cmdline.split(/\s+/).some((arg) => arg === "rd.live.image" || arg.startsWith("rd.live.image="));
}

/** Whether this run only pretends: not a live boot, or asked to (`DASHI_INSTALL=dry-run`). */
export function isDryRun(env: Env = process.env, cmdline: () => string = () => readCmdline()): boolean {
  if (env.DASHI_INSTALL === "dry-run") return true;
  return !isLiveBoot(cmdline());
}

function readCmdline(): string {
  try {
    return readFileSync("/proc/cmdline", "utf8");
  } catch {
    return "";
  }
}

/** The command for `choice`, or null when there is nothing to run. */
export function helperCommand(
  choice: InstallChoice,
  dryRun: boolean,
  exists: (path: string) => boolean = existsSync,
  which: (program: string) => string | null = (program) => Bun.which(program),
): string[] | null {
  if (dryRun) {
    const helper = exists(CHECKOUT_HELPER) ? CHECKOUT_HELPER : HELPER_PATH;
    return exists(helper) ? [helper, "--dry-run", ...installArgs(choice)] : null;
  }
  const pkexec = which("pkexec");
  return pkexec !== null && exists(HELPER_PATH) ? [pkexec, HELPER_PATH, ...installArgs(choice)] : null;
}

/** Run the install; `onEvent` hears each event. Resolves to the exit status (null: it never started). */
export async function runInstall(choice: InstallChoice, password: string, dryRun: boolean, onEvent: (event: InstallEvent) => void): Promise<number | null> {
  const command = helperCommand(choice, dryRun);
  if (command === null) return null;
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  } catch (error) {
    console.error("dev.dashi.installer: could not start dashi-install:", error instanceof Error ? error.message : error);
    return null;
  }
  const stdin = child.stdin as import("bun").FileSink;
  stdin.write(`${password}\n`);
  await stdin.end();
  const splitter = new LineSplitter();
  const decoder = new TextDecoder();
  const take = (lines: string[]) => {
    for (const line of lines) {
      const event = parseEvent(line);
      if (event) onEvent(event);
    }
  };
  for await (const chunk of child.stdout as ReadableStream<Uint8Array>) take(splitter.push(decoder.decode(chunk, { stream: true })));
  take(splitter.end());
  return await child.exited;
}
