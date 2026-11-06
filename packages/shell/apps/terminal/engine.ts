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
  | { t: "copy" }
  /** The terminal's ink, ground, and 16 ANSI colors (palette.ts). */
  | { t: "colors"; fg: string; bg: string; palette: readonly string[] }
  | { t: "running" };

export interface Engine {
  send(input: EngineInput): void;
  /** Hang up the shell (closing the window). */
  stop(): void;
  /**
   * What runs in front of the shell (a command, `ssh`, `vim`): its name, ""
   * when it has none, or null at the prompt, and null too when the engine
   * doesn't answer in time or is gone.
   */
  running(): Promise<string | null>;
}

/** How long a `running` question waits for its answer (ms). */
const RUNNING_WAIT = 400;

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
  // Answers to `running` come back in the order the questions went.
  const asking: ((program: string | null) => void)[] = [];
  void (async () => {
    for await (const chunk of child.stdout) {
      for (const line of lines.push(chunk)) {
        const message = parseEngineLine(line);
        if (message?.t === "running") asking.shift()?.(message.program);
        else if (message) onMessage(message);
      }
    }
    for (const answer of asking.splice(0)) answer(null);
  })();
  let open = true;
  const engine: Engine = {
    running() {
      if (!open) return Promise.resolve(null);
      return new Promise((resolve) => {
        let answered = false;
        const answer = (program: string | null): void => {
          if (answered) return;
          answered = true;
          clearTimeout(timer);
          resolve(program);
        };
        // Too late: the answer, when it comes, still takes its place in the queue.
        const timer = setTimeout(() => answer(null), RUNNING_WAIT);
        asking.push(answer);
        engine.send({ t: "running" });
      });
    },
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
  return engine;
}
