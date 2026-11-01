/**
 * A long-lived command whose output lines are events (`nmcli monitor`),
 * restarted when it exits. A missing program is not an error: there is
 * nothing to watch.
 */

export interface WatchOptions {
  /** Wait before the first restart; it doubles up to `maxDelayMs`. */
  restartMs?: number;
  maxDelayMs?: number;
  /** A run at least this long starts the delay over. */
  healthyMs?: number;
  /** For tests. */
  spawn?: (command: string[]) => { stdout: ReadableStream<Uint8Array>; exited: Promise<number>; kill(): void };
  which?: (program: string) => string | null;
}

/** Calls `onLine` for each line the command prints; returns the stop function. */
export function watchLines(command: readonly string[], onLine: (line: string) => void, options: WatchOptions = {}): () => void {
  const { restartMs = 2000, maxDelayMs = 60_000, healthyMs = 30_000 } = options;
  const which = options.which ?? ((program: string) => Bun.which(program));
  const spawn =
    options.spawn ??
    ((cmd: string[]) => Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "ignore", env: { ...process.env, LC_ALL: "C" } }));
  const [program] = command;
  if (program === undefined || which(program) === null) return () => {};

  let stopped = false;
  let child: ReturnType<typeof spawn> | null = null;
  let wake: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });

  const loop = async () => {
    let delay = restartMs;
    while (!stopped) {
      const started = Date.now();
      try {
        child = spawn([...command]);
        await readLines(child.stdout, (line) => !stopped && onLine(line));
        await child.exited;
      } catch {
        // Spawning failed or the pipe broke; try again after the delay.
      }
      child = null;
      if (stopped) return;
      if (Date.now() - started >= healthyMs) delay = restartMs;
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  };
  void loop();

  return () => {
    stopped = true;
    clearTimeout(timer);
    wake?.();
    child?.kill();
  };
}

/** The complete lines of a byte stream (a last line without a newline counts). */
export async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  }
  pending += decoder.decode();
  if (pending !== "") onLine(pending);
}
