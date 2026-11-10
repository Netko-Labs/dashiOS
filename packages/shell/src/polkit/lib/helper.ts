/**
 * polkit's setuid helper, the one program that may ask PAM about someone
 * else's password and tell polkitd the answer. We spawn it with the user's
 * name as its only argument, write the request's cookie on its stdin, then it
 * talks in lines (the same protocol libpolkit-agent speaks):
 *
 *   PAM_PROMPT_ECHO_OFF Password:    answer with the secret and a newline
 *   PAM_PROMPT_ECHO_ON  Code:        answer with text that may be shown
 *   PAM_TEXT_INFO / PAM_ERROR_MSG    something to tell the person
 *   SUCCESS / FAILURE                the end; polkitd has already been told
 *
 * The password goes down the pipe and nowhere else: never argv, never the
 * environment, never a log line.
 */

import { existsSync } from "node:fs";
import { LineBuffer } from "../../shared/io/lines.ts";

export type HelperEvent =
  | { type: "prompt"; text: string; echo: boolean }
  | { type: "info"; text: string }
  | { type: "error"; text: string }
  | { type: "success" }
  | { type: "failure" }
  /** The helper ended without saying SUCCESS or FAILURE (it could not start, or it crashed). */
  | { type: "exit"; code: number | null };

/** Where distributions put the helper. */
export const HELPER_PATHS: readonly string[] = [
  "/usr/lib/polkit-1/polkit-agent-helper-1",
  "/usr/libexec/polkit-1/polkit-agent-helper-1",
  "/usr/libexec/polkit-agent-helper-1",
  "/usr/lib64/polkit-1/polkit-agent-helper-1",
  "/usr/lib/policykit-1/polkit-agent-helper-1",
];

export function findHelper(exists: (path: string) => boolean = existsSync): string | null {
  return HELPER_PATHS.find((path) => exists(path)) ?? null;
}

/** A line the helper never ends is a runaway; this much of one is the most we hold. */
const MAX_LINE = 4096;
const MAX_TEXT = 200;

const text = (line: string, prefix: string): string =>
  line
    .slice(prefix.length)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, MAX_TEXT);

/** One line of the helper's output as an event; null for a line this protocol does not have. */
export function parseHelperLine(raw: string): HelperEvent | null {
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (line === "SUCCESS") return { type: "success" };
  if (line === "FAILURE") return { type: "failure" };
  if (line.startsWith("PAM_PROMPT_ECHO_OFF")) return { type: "prompt", text: text(line, "PAM_PROMPT_ECHO_OFF"), echo: false };
  if (line.startsWith("PAM_PROMPT_ECHO_ON")) return { type: "prompt", text: text(line, "PAM_PROMPT_ECHO_ON"), echo: true };
  if (line.startsWith("PAM_TEXT_INFO")) return { type: "info", text: text(line, "PAM_TEXT_INFO") };
  if (line.startsWith("PAM_ERROR_MSG")) return { type: "error", text: text(line, "PAM_ERROR_MSG") };
  return null;
}

export interface HelperProcess {
  /** Answer the pending prompt. False when the helper is not listening any more. */
  respond(answer: string): Promise<boolean>;
  /** Stop the helper and ignore anything it still says. Safe to repeat. */
  stop(): void;
}

export interface HelperOptions {
  path: string;
  /** The account to authenticate; checked by the caller (users.ts). */
  user: string;
  cookie: string;
  /** Added to the helper's small fixed environment (tests use this to find out what it was given). */
  env?: Readonly<Record<string, string>>;
}

/** Bytes to the child's stdin, flushed; false if the pipe is gone. The bytes are wiped afterwards. */
async function writeLine(stdin: Bun.FileSink, line: string): Promise<boolean> {
  const bytes = new TextEncoder().encode(`${line}\n`);
  try {
    // write() takes what it can and holds the rest; flush() resolves once it is all in the pipe.
    await stdin.write(bytes);
    await stdin.flush();
    return true;
  } catch {
    return false;
  } finally {
    bytes.fill(0);
  }
}

/**
 * Run the helper for one attempt. Events arrive asynchronously, never from
 * inside this call, and stop arriving after `stop()` or the first
 * SUCCESS/FAILURE.
 */
export function startHelper(options: HelperOptions, onEvent: (event: HelperEvent) => void): HelperProcess {
  let stopped = false;
  let ended = false;
  const emit = (event: HelperEvent): void => {
    if (stopped || ended) return;
    if (event.type === "success" || event.type === "failure" || event.type === "exit") ended = true;
    onEvent(event);
  };

  let child: Bun.Subprocess<"pipe", "pipe", "ignore">;
  try {
    child = Bun.spawn([options.path, options.user], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: { PATH: "/usr/sbin:/usr/bin", LANG: process.env.LANG ?? "C", ...options.env },
    });
  } catch (error) {
    console.error("dashi-shell: polkit: could not start the authentication helper:", error instanceof Error ? error.message : error);
    queueMicrotask(() => emit({ type: "exit", code: null }));
    return { respond: async () => false, stop() {} };
  }

  void writeLine(child.stdin, options.cookie);
  const lines = new LineBuffer();
  const read = async (): Promise<void> => {
    const reader = child.stdout.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        for (const line of lines.push(value)) {
          const event = parseHelperLine(line);
          if (event) emit(event);
        }
        if (lines.pending > MAX_LINE) return child.kill();
      }
    } catch {
      // The pipe broke; the exit below says so.
    }
  };
  void Promise.all([read(), child.exited]).then(([, code]) => emit({ type: "exit", code }));

  return {
    respond: (answer) => (stopped || ended ? Promise.resolve(false) : writeLine(child.stdin, answer)),
    stop() {
      if (stopped) return;
      stopped = true;
      child.kill();
      try {
        void Promise.resolve(child.stdin.end()).catch(() => {});
      } catch {
        // The pipe is already gone.
      }
    },
  };
}
