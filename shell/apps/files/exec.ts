/** Running other programs: structured arguments only, never a shell string; output is read whole and bounded. */

export interface ExecResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
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
}

export type Exec = (command: readonly string[], options?: ExecOptions) => Promise<ExecResult>;

const LIMIT = 4 * 1024 * 1024;

async function readBounded(stream: ReadableStream<Uint8Array> | null | undefined, limit: number): Promise<string> {
  if (!stream) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    if (size < limit) chunks.push(chunk.subarray(0, limit - size));
    size += chunk.length;
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

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
    const [stdout, stderr] = options.quiet
      ? ["", ""]
      : await Promise.all([readBounded(child.stdout as ReadableStream<Uint8Array>, limit), readBounded(child.stderr as ReadableStream<Uint8Array>, limit)]);
    const code = await child.exited;
    options.signal?.removeEventListener("abort", stop);
    return { ok: code === 0, code, stdout, stderr };
  } catch (error) {
    return { ok: false, code: null, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
};
