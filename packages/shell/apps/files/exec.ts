/** Running other programs: structured arguments only, never a shell string; output is read whole and bounded. */

export interface ExecResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** It hadn't finished by `timeoutMs`; it is left running. */
  timedOut?: true;
}

export interface ExecOptions {
  input?: string;
  /** Kills the program when it aborts. */
  signal?: AbortSignal;
  cwd?: string;
  /** Output kept per stream, bytes; the rest is dropped. */
  limit?: number;
  /** Don't read the output: for programs that leave a copy of themselves holding the pipes (wl-copy). */
  quiet?: boolean;
  /**
   * The program is done when it exits, whoever still holds its pipes: for a
   * launcher (`gio open`) whose app inherits them and runs on. What it wrote
   * by then is the output; the pipes are read on, and dropped, until the app
   * closes them (never closed early: a write would kill the app).
   */
  untilExit?: boolean;
  /** Stop waiting after this long: the answer says `timedOut`, and the program is left running. */
  timeoutMs?: number;
}

export type Exec = (command: readonly string[], options?: ExecOptions) => Promise<ExecResult>;

const LIMIT = 4 * 1024 * 1024;
/** After a launcher exits, how long what it wrote last has to arrive. */
const DRAIN_MS = 100;

/** A stream read to its end in the background, its first `limit` bytes kept; `text()` is what has come so far. */
function collect(stream: ReadableStream<Uint8Array> | null | undefined, limit: number): { done: Promise<void>; text: () => string } {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const done = (async () => {
    if (!stream) return;
    try {
      for await (const chunk of stream) {
        if (size < limit) chunks.push(chunk.subarray(0, limit - size));
        size += chunk.length;
      }
    } catch {
      // The pipe broke: what came is the output.
    }
  })();
  return { done, text: () => new TextDecoder().decode(Buffer.concat(chunks)) };
}

const after = (ms: number): Promise<"late"> => new Promise((resolve) => setTimeout(() => resolve("late"), ms));

export const exec: Exec = async (command, options = {}) => {
  const limit = options.limit ?? LIMIT;
  try {
    const child = Bun.spawn([...command], {
      stdin: options.input === undefined ? "ignore" : "pipe",
      stdout: options.quiet ? "ignore" : "pipe",
      stderr: options.quiet ? "ignore" : "pipe",
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    const stop = (): void => {
      child.kill();
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    if (options.input !== undefined) {
      const stdin = child.stdin as { write(data: string): number; end(): unknown };
      stdin.write(options.input);
      await stdin.end();
    }
    const stdout = collect(options.quiet ? null : (child.stdout as ReadableStream<Uint8Array>), limit);
    const stderr = collect(options.quiet ? null : (child.stderr as ReadableStream<Uint8Array>), limit);
    // Done when it exits and (unless `untilExit`) its pipes close; or when the time is up.
    const finished = options.untilExit
      ? child.exited.then(async (code) => {
          await Promise.race([Promise.all([stdout.done, stderr.done]), after(DRAIN_MS)]);
          return code;
        })
      : Promise.all([stdout.done, stderr.done]).then(() => child.exited);
    const code = await (options.timeoutMs === undefined ? finished : Promise.race([finished, after(options.timeoutMs)]));
    options.signal?.removeEventListener("abort", stop);
    if (code === "late") return { ok: false, code: null, stdout: stdout.text(), stderr: stderr.text(), timedOut: true };
    return { ok: code === 0, code, stdout: stdout.text(), stderr: stderr.text() };
  } catch (error) {
    return { ok: false, code: null, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
};
