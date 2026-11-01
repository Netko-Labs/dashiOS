/**
 * Running the system's own tools (nmcli, wpctl, brightnessctl, playerctl).
 * A tool that is missing, slow, or failing is an answer of `null`, never an
 * exception: a desktop without Wi-Fi or a mixer still has a menu bar.
 */

/** Runs a command; its trimmed stdout, or null if it could not run or failed. */
export type Run = (command: readonly string[]) => Promise<string | null>;

/** A tool that has not answered by now is stuck. */
const TIMEOUT_MS = 4000;

export const run: Run = async (command) => {
  try {
    const child = Bun.spawn([...command], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      // The tools' output is parsed, so it must not be translated.
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
      timeout: TIMEOUT_MS,
    });
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return code === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
};

/** Whether a program is on PATH. */
export function hasProgram(program: string): boolean {
  return Bun.which(program) !== null;
}
