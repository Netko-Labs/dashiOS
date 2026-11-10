/**
 * Changing the password with the system's own `passwd`, run on a pseudo
 * terminal because PAM asks on the terminal: the current password, the new
 * one, and the new one again. That keeps every rule the machine has
 * (checking the current password, quality rules, lockouts) and the password
 * file untouched by Dashi.
 *
 * The passwords exist only in this call: they are written to the terminal
 * and never to argv, a file, or a log, and no output of the tool is kept
 * except one line from its password rules ("BAD PASSWORD: …"), which does
 * not contain them. The tool is run in the C locale so its prompts can be
 * recognised.
 */

import type { PasswordFailure, PasswordResult } from "../../shared/accounts/types.ts";
import { cleanText } from "../../shared/io/text.ts";

/** A running tool on a terminal. */
export interface PtyProcess {
  write(text: string): void;
  /** Ends it; only ever the child this module started. */
  kill(): void;
  exited: Promise<number>;
}

/** Starts `command` on a terminal; `onData` hears what it prints. */
export type SpawnPty = (command: readonly string[], onData: (text: string) => void) => PtyProcess;

/** A tool that is still asking after this long is stuck. */
const TIMEOUT_MS = 30_000;
// eslint-disable-next-line no-control-regex
const ESCAPES = /\u001b\[[0-9;?]*[A-Za-z]/g;
const CURRENT = /(?:current|old)[^\n]*password:\s*$/i;
const RETYPE = /retype[^\n]*password:\s*$/i;
const NEW = /new[^\n]*password:\s*$/i;
const RULE = /(?:BAD PASSWORD:|Password change rejected:)\s*(.+)/i;
const REFUSED = /(?:too (?:short|simple|similar|many)|dictionary|palindrome|same as|BAD PASSWORD|do not match|no longer than|at least)/i;
const WRONG_CURRENT = /authentication (?:failure|token manipulation)|incorrect password|current password/i;

/** The tool's own words about the new password: one short line, or null. */
export function ruleLine(output: string): string | null {
  const line = RULE.exec(output)?.[1] ?? output.split("\n").find((text) => REFUSED.test(text));
  if (!line) return null;
  const text = cleanText(line.replace(/^BAD PASSWORD:\s*/i, ""));
  return text === "" ? null : text.slice(0, 160);
}

export function spawnPasswd(spawn: SpawnPty, timeoutMs: number = TIMEOUT_MS): { change(current: string, next: string): Promise<PasswordResult> } {
  return {
    change: (current, next) =>
      new Promise<PasswordResult>((resolve) => {
        let settled = false;
        let buffer = "";
        let history = "";
        let answeredCurrent = false;
        let newAnswers = 0;
        let proc: PtyProcess | null = null;
        const finish = (result: PasswordResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          proc?.kill();
          resolve(result);
        };
        const fail = (reason: PasswordFailure, message: string | null = null) => finish({ ok: false, reason, message });
        const timer = setTimeout(() => fail("timeout"), timeoutMs);
        const hear = (text: string) => {
          if (settled) return;
          const clean = text.replace(ESCAPES, "").replaceAll("\r", "");
          buffer += clean;
          history += clean;
          if (RETYPE.test(buffer)) {
            buffer = "";
            proc?.write(`${next}\n`);
          } else if (CURRENT.test(buffer)) {
            // A second ask for the current password means the first was refused.
            if (answeredCurrent) return fail("wrong-current");
            answeredCurrent = true;
            buffer = "";
            proc?.write(`${current}\n`);
          } else if (NEW.test(buffer)) {
            // The rules refused the first one and asked again: don't feed it a second.
            if (newAnswers >= 1) return fail("rejected", ruleLine(history));
            newAnswers++;
            buffer = "";
            proc?.write(`${next}\n`);
          }
        };
        try {
          proc = spawn(["passwd"], hear);
        } catch {
          return fail("failed");
        }
        void proc.exited.then(
          (code) => {
            if (settled) return;
            if (code === 0) return finish({ ok: true });
            // Refused before the new password was asked for: the current one was wrong.
            if (newAnswers === 0 && (answeredCurrent || WRONG_CURRENT.test(history))) return fail("wrong-current");
            const refused = ruleLine(history);
            fail(newAnswers > 0 || refused !== null ? "rejected" : "failed", refused);
          },
          () => fail("failed"),
        );
      }),
  };
}

/** `passwd` on a real terminal through Bun. */
export const bunPty: SpawnPty = (command, onData) => {
  const decoder = new TextDecoder();
  const child = Bun.spawn([...command], {
    env: { ...process.env, LC_ALL: "C", LANG: "C", LANGUAGE: "C" },
    terminal: { cols: 80, rows: 24, data: (_terminal, data) => onData(decoder.decode(data)) },
  });
  return {
    write: (text) => child.terminal?.write(text),
    kill: () => {
      child.terminal?.close();
      child.kill();
    },
    exited: child.exited,
  };
};
