/**
 * Running the helper programs (poppler, ImageMagick, gio). Everything Preview
 * opens is untrusted, so each run gets structured arguments (never a shell),
 * a time limit, a cap on what it may print, and, where `prlimit` exists, a
 * cap on its memory and CPU time.
 */

export interface RunOptions {
  /** Kill it after this long. */
  timeoutMs: number;
  /** Bytes of standard output kept (the rest is dropped and the process stopped). */
  maxOutput?: number;
  /** Address space cap in MiB, applied with `prlimit` when it is installed. */
  memoryMiB?: number;
  /** Bytes fed to standard input. */
  input?: Uint8Array | Bun.BunFile;
  env?: Record<string, string>;
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** The environment helpers get: where programs are and how text is spoken, nothing else of ours. */
export function toolEnv(extra: Record<string, string> = {}, env: Record<string, string | undefined> = process.env): Record<string, string> {
  const pick = (name: string): Record<string, string> => (env[name] ? { [name]: env[name] as string } : {});
  return {
    ...pick("PATH"),
    ...pick("HOME"),
    ...pick("XDG_CACHE_HOME"),
    ...pick("XDG_DATA_DIRS"),
    ...pick("XDG_DATA_HOME"),
    ...pick("XDG_RUNTIME_DIR"),
    ...pick("DBUS_SESSION_BUS_ADDRESS"),
    LANG: "C.UTF-8",
    ...extra,
  };
}

/** The command line with its limits: `prlimit --as=… --cpu=… -- argv`. */
export function limited(
  argv: readonly string[],
  options: Pick<RunOptions, "timeoutMs" | "memoryMiB">,
  prlimit: string | null = Bun.which("prlimit"),
): string[] {
  if (!prlimit || options.memoryMiB === undefined) return [...argv];
  const cpu = Math.max(1, Math.ceil(options.timeoutMs / 1000));
  return [prlimit, `--as=${options.memoryMiB * 1024 * 1024}`, `--cpu=${cpu}`, "--", ...argv];
}

/** Whether a program can be found. */
export const haveTool = (name: string): boolean => Bun.which(name) !== null;

async function readCapped(stream: ReadableStream<Uint8Array>, cap: number, onFull: () => void): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    if (total < cap) chunks.push(chunk.subarray(0, cap - total));
    total += chunk.length;
    if (total > cap) onFull();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function runTool(argv: readonly string[], options: RunOptions): Promise<RunResult> {
  const cap = options.maxOutput ?? 1024 * 1024;
  let child: Bun.Subprocess<"pipe" | "ignore" | Bun.BunFile | Uint8Array, "pipe", "pipe">;
  try {
    child = Bun.spawn(limited(argv, options), {
      stdin: options.input ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: toolEnv(options.env),
    }) as typeof child;
  } catch (error) {
    return { ok: false, code: null, stdout: "", stderr: String(error), timedOut: false };
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      readCapped(child.stdout, cap, () => child.kill("SIGKILL")),
      readCapped(child.stderr, 64 * 1024, () => {}),
      child.exited,
    ]);
    return { ok: code === 0 && !timedOut, code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}
