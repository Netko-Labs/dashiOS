/**
 * Running `flatpak`, `pkcon`, and `dnf`: always a program and an argument
 * list (never a shell string), with the locale pinned so the output parses.
 * `terminal: true` runs the program on a pseudo-terminal, which is the only
 * way flatpak prints its progress bar; the output then carries terminal
 * escapes (flatpak-parse.ts reads them).
 */

export interface RunOptions {
  /** Called with output as it arrives. */
  onOutput?: (chunk: string) => void;
  terminal?: boolean;
  /** Ends the process (SIGTERM) when it aborts. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RunResult {
  /** Null when the process could not start. */
  code: number | null;
  /** Standard output and error together, the last `OUTPUT_TAIL` characters. */
  output: string;
}

export type Runner = (command: readonly string[], options?: RunOptions) => Promise<RunResult>;

const OUTPUT_TAIL = 200_000;

/** The environment for tools whose output is parsed: English, UTF-8, no pager, no color. */
export function toolEnv(base: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined) env[key] = value;
  return { ...env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8", LANGUAGE: "C", NO_COLOR: "1", PAGER: "cat", TERM: env.TERM || "xterm-256color" };
}

/** A PTY option, as Bun takes it (typed here because the installed typings may predate it). */
interface TerminalOption {
  cols: number;
  rows: number;
  data(terminal: unknown, data: Uint8Array): void;
}

export const run: Runner = async (command, options = {}) => {
  const decoder = new TextDecoder();
  let output = "";
  const take = (chunk: string): void => {
    output = (output + chunk).slice(-OUTPUT_TAIL);
    options.onOutput?.(chunk);
  };
  let process_: ReturnType<typeof Bun.spawn>;
  try {
    const spawnOptions: Record<string, unknown> = { env: toolEnv(), stdin: "ignore" };
    if (options.terminal) {
      const terminal: TerminalOption = { cols: 120, rows: 30, data: (_terminal, data) => take(decoder.decode(data, { stream: true })) };
      spawnOptions.terminal = terminal;
      delete spawnOptions.stdin;
    } else {
      spawnOptions.stdout = "pipe";
      spawnOptions.stderr = "pipe";
    }
    process_ = Bun.spawn([...command], spawnOptions as Parameters<typeof Bun.spawn>[1]);
  } catch (error) {
    return { code: null, output: error instanceof Error ? error.message : String(error) };
  }
  const stop = (): void => {
    try {
      process_.kill("SIGTERM");
    } catch {
      // Already gone.
    }
  };
  options.signal?.addEventListener("abort", stop, { once: true });
  const timer = options.timeoutMs ? setTimeout(stop, options.timeoutMs) : null;
  try {
    if (!options.terminal) {
      const read = async (stream: unknown): Promise<void> => {
        if (!(stream instanceof ReadableStream)) return;
        const reader = stream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value instanceof Uint8Array) take(decoder.decode(value, { stream: true }));
        }
      };
      await Promise.all([read(process_.stdout), read(process_.stderr)]);
    }
    const code = await process_.exited;
    return { code, output };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", stop);
  }
};
