/**
 * Telling systemd --user and D-Bus activation where this session's display
 * is. Services they start on demand (portals, D-Bus-activated apps) don't
 * inherit our environment; without this they cannot find Wayland.
 */

/** What those services need to know about the session. */
export const SESSION_VARIABLES: readonly string[] = [
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "XDG_CURRENT_DESKTOP",
  "XDG_SESSION_TYPE",
  "XDG_SESSION_DESKTOP",
  // logind's session class: user services check it (LocalSearch, the
  // indexer behind Files' search, runs only for XDG_SESSION_CLASS=user).
  "XDG_SESSION_CLASS",
  // Where apps are (flatpak's exports among them, dashi-session): a portal or a
  // D-Bus-activated app opening a file looks there for the handler.
  "XDG_DATA_DIRS",
  // Lets D-Bus-activated apps find the keyring started for this session.
  "GNOME_KEYRING_CONTROL",
];

type Environment = Readonly<Record<string, string | undefined>>;

/** The commands to run: only for variables that are set, only for tools that exist. */
export function importCommands(env: Environment, which: (program: string) => string | null): string[][] {
  const names = SESSION_VARIABLES.filter((name) => Boolean(env[name]));
  if (names.length === 0) return [];
  const commands: string[][] = [];
  if (which("systemctl")) commands.push(["systemctl", "--user", "import-environment", ...names]);
  if (which("dbus-update-activation-environment")) {
    commands.push(["dbus-update-activation-environment", "--systemd", ...names]);
  }
  return commands;
}

export interface ImportDeps {
  env: Environment;
  which(program: string): string | null;
  /** Run `command`; resolves to null on success, otherwise why not. */
  run(command: readonly string[]): Promise<string | null>;
  log(message: string): void;
}

/** Best effort: a missing user bus must not keep the desktop from starting. */
export async function importSessionEnvironment(deps: ImportDeps): Promise<void> {
  const commands = importCommands(deps.env, deps.which);
  if (commands.length === 0) {
    deps.log("no systemd --user or D-Bus activation to tell about the session");
    return;
  }
  for (const command of commands) {
    const failure = await deps.run(command);
    if (failure === null) deps.log(`ran ${command.join(" ")}`);
    else deps.log(`${command[0]} failed (${failure}); portals and D-Bus-activated apps may not find the display`);
  }
}

/** Run a command to completion with a deadline, keeping what it printed. */
export async function captureWithTimeout(command: readonly string[], timeoutMs = 10_000): Promise<{ stdout: string; failure: string | null }> {
  try {
    const child = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code === 0) return { stdout, failure: null };
    const detail = stderr.trim().split("\n")[0] ?? "";
    return { stdout, failure: `exit ${code}${detail ? `: ${detail}` : ""}` };
  } catch (error) {
    return { stdout: "", failure: String(error) };
  }
}

/** Run a command to completion with a deadline; null when it exited 0. */
export async function runWithTimeout(command: readonly string[], timeoutMs = 5_000): Promise<string | null> {
  try {
    const child = Bun.spawn([...command], { stdin: "ignore", stdout: "ignore", stderr: "pipe", timeout: timeoutMs });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (code === 0) return null;
    const detail = stderr.trim().split("\n")[0] ?? "";
    return `exit ${code}${detail ? `: ${detail}` : ""}`;
  } catch (error) {
    return String(error);
  }
}
