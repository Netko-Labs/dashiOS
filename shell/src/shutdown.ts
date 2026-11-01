/**
 * Ending the shell: every closer runs on its own, so one that throws cannot
 * skip the rest or the `process.exit` that follows. The session supervisor
 * counts a shell that hangs half-closed as a crash.
 */

export type Closer = readonly [name: string, close: () => void];

/** Runs each closer in order; a throw is logged and the next one still runs. Returns the names that threw. */
export function runClosers(closers: readonly Closer[], log: (message: string, error: unknown) => void = console.error): string[] {
  const failed: string[] = [];
  for (const [name, close] of closers) {
    try {
      close();
    } catch (error) {
      failed.push(name);
      log(`dashi-shell: closing ${name} failed:`, error);
    }
  }
  return failed;
}
