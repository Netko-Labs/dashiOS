/**
 * Running `dashi-extras` as root: `pkexec /usr/libexec/dashi/dashi-extras
 * <step>...`, an argument list (no shell), whose stdout is read line by line
 * into events. polkit asks for the password on the shell's own sheet (the
 * authentication agent in src/polkit). The helper's stderr (dnf's and
 * flatpak's output) goes to the shell's log.
 *
 * A dry run (`DASHI_EXTRAS=dry-run`, and always in a development run, which
 * must never reach the machine's own pkexec) runs the helper with
 * `--dry-run` and without pkexec, to look at the pages without changing
 * anything: the checkout's session/dashi-extras when there is one, else the
 * installed one.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { type ExtraStep, type ExtrasEvent, isExtraStep, LineSplitter, parseEvent } from "./events.ts";

export const HELPER_PATH = "/usr/libexec/dashi/dashi-extras";
/** session/dashi-extras in a checkout, from src/setup/extras. */
const CHECKOUT_HELPER = join(import.meta.dir, "../../../../../session/dashi-extras");

type Env = Readonly<Record<string, string | undefined>>;

export const isDryRun = (env: Env = process.env): boolean => env.DASHI_EXTRAS === "dry-run";

/** The command for `steps`, or null when there is no helper to run. */
export function helperCommand(
  steps: readonly ExtraStep[],
  dryRun: boolean,
  exists: (path: string) => boolean = existsSync,
  which: (program: string) => string | null = (program) => Bun.which(program),
): string[] | null {
  // Only known step names reach the command line.
  const args = steps.filter(isExtraStep);
  if (dryRun) {
    const helper = exists(CHECKOUT_HELPER) ? CHECKOUT_HELPER : HELPER_PATH;
    return exists(helper) ? [helper, "--dry-run", ...args] : null;
  }
  const pkexec = which("pkexec");
  return pkexec !== null && exists(HELPER_PATH) ? [pkexec, HELPER_PATH, ...args] : null;
}

/** Whether the optional software can be offered here at all. */
export const hasHelper = (dryRun: boolean): boolean => helperCommand(["flathub"], dryRun) !== null;

export interface HelperRun {
  /** The exit status, or null when it could not start. */
  code: number | null;
  /** Whether it said anything parseable (pkexec that ran nothing says nothing). */
  sawEvents: boolean;
}

export type RunHelper = (steps: readonly ExtraStep[], onEvent: (event: ExtrasEvent) => void) => Promise<HelperRun>;

/** The helper, run for real or (`dryRun`) as a dry run; it calls `onEvent` for each event as it comes. */
export const helperRunner =
  (dryRun: boolean): RunHelper =>
  async (steps, onEvent) => {
    const command = helperCommand(steps, dryRun);
    if (command === null) return { code: null, sawEvents: false };
    // A dry run walks slowly enough to watch, unless told otherwise.
    const env = dryRun ? { ...process.env, DASHI_EXTRAS_DELAY: process.env.DASHI_EXTRAS_DELAY ?? "0.6" } : process.env;
    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "inherit", env });
    } catch (error) {
      console.error("dashi-shell: could not start dashi-extras:", error instanceof Error ? error.message : error);
      return { code: null, sawEvents: false };
    }
    const splitter = new LineSplitter();
    const decoder = new TextDecoder();
    let sawEvents = false;
    const take = (lines: string[]): void => {
      for (const line of lines) {
        const event = parseEvent(line);
        if (event === null) continue;
        sawEvents = true;
        onEvent(event);
      }
    };
    const { stdout } = child;
    if (stdout instanceof ReadableStream) {
      const reader = stdout.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        take(splitter.push(decoder.decode(value as Uint8Array, { stream: true })));
      }
    }
    take(splitter.end());
    return { code: await child.exited, sawEvents };
  };
