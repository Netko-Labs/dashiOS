/**
 * Another Text Editor window: one process per window, as Preview has, so a
 * window is the document's and closing it ends only that one. The new
 * process runs the same Bun on the same main.tsx with the same Metal host.
 */

export interface Launch {
  bun: string;
  main: string;
  host: string;
}

/** The command line for a window on `files` (none: Untitled), or on a kept recovery file. */
export function windowCommand(launch: Launch, files: readonly string[], recover: string | null = null): string[] {
  return [launch.bun, launch.main, "--host", launch.host, ...(recover !== null ? ["--recover", recover] : []), ...(files.length > 0 ? ["--", ...files] : [])];
}

/** Starts it, not waiting on it: it lives on when this window goes. */
export function openWindow(command: readonly string[], cwd: string): void {
  try {
    Bun.spawn([...command], { cwd, stdio: ["ignore", "ignore", "inherit"] }).unref();
  } catch (error) {
    console.error(`dev.dashi.editor: couldn't open a window: ${error instanceof Error ? error.message : String(error)}`);
  }
}
