/**
 * dashi-term, the Terminal's engine (crates/dashi-term): it runs the shell on
 * a PTY and keeps the terminal in libghostty-vt; this process draws what it
 * says and sends it the person's input. One JSON object per line each way
 * (screen.ts parses what comes back).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { LineBuffer } from "../../src/lines.ts";
import { type EngineMessage, parseEngineLine } from "./screen.ts";

/** What the app sends: crates/dashi-term/src/protocol.rs `Input`. */
export type EngineInput =
  | { t: "key"; key: string; text?: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; repeat: boolean }
  | { t: "paste"; text: string }
  | { t: "resize"; cols: number; rows: number; cw: number; ch: number }
  | { t: "scroll"; lines: number }
  | { t: "select"; phase: "down" | "move" | "up"; x: number; y: number; clicks: number }
  | { t: "select-all" }
  | { t: "copy" };

export interface Engine {
  send(input: EngineInput): void;
  /** Hang up the shell (closing the window). */
  stop(): void;
}

/** Where dashi-term is: `DASHI_TERM`, the installed one, or this checkout's build. */
export function engineBinary(env: Record<string, string | undefined> = process.env, exists: (path: string) => boolean = existsSync): string | null {
  const candidates = [env.DASHI_TERM, "/usr/libexec/dashi/dashi-term", join(import.meta.dir, "../../../../crates/dashi-term/target/release/dashi-term")];
  return candidates.find((path): path is string => typeof path === "string" && path !== "" && exists(path)) ?? null;
}

export function startEngine(binary: string, size: { cols: number; rows: number }, onMessage: (message: EngineMessage) => void): Engine {
  const home = process.env.HOME;
  const child = Bun.spawn([binary, "--cols", String(size.cols), "--rows", String(size.rows), ...(home ? ["--cwd", home] : [])], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const lines = new LineBuffer();
  void (async () => {
    for await (const chunk of child.stdout) {
      for (const line of lines.push(chunk)) {
        const message = parseEngineLine(line);
        if (message) onMessage(message);
      }
    }
  })();
  let open = true;
  return {
    send(input) {
      if (!open) return;
      try {
        child.stdin.write(`${JSON.stringify(input)}\n`);
        void child.stdin.flush();
      } catch {
        open = false;
      }
    },
    stop() {
      if (!open) return;
      open = false;
      try {
        void child.stdin.end();
      } catch {}
    },
  };
}
