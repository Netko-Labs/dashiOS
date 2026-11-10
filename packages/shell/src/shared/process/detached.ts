/** Starting a program the caller does not wait for: the menus' New Window and Help, the session's log out, Software's links. */

/** Runs a command detached from the shell's input and output. */
export function spawnDetached(command: readonly string[]): void {
  try {
    Bun.spawn([...command], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
  } catch (error) {
    console.error(`dashi-shell: could not run ${command[0]}:`, error);
  }
}
