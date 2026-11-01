/**
 * The Secret Service: Chrome, VS Code, and many other apps keep passwords
 * through org.freedesktop.secrets and fail or nag without a provider.
 * gnome-keyring-daemon provides it. Where the display manager's PAM stack has
 * pam_gnome_keyring (GDM, SDDM) the login password already unlocked the
 * keyring and started the daemon, and `--start` just reports it. Where it
 * does not (greetd without that PAM line, an autologin), the daemon starts
 * locked and the first app to ask gets a prompt from gcr.
 */

/** The only variable we take from the daemon's answer. */
const KEYRING_VARIABLE = "GNOME_KEYRING_CONTROL";

/**
 * Parse `gnome-keyring-daemon --start` output (`NAME=value` lines). Anything
 * but the one variable, with a plain absolute path, is ignored: the output is
 * a process's stdout, not a trusted source.
 */
export function parseKeyringEnvironment(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const match = /^(GNOME_KEYRING_CONTROL)=(\/[A-Za-z0-9._/+-]*)$/.exec(line.trim());
    if (match?.[1] && match[2]) result[match[1]] = match[2];
  }
  return result;
}

export interface KeyringDeps {
  which(program: string): string | null;
  /** Run a command; its stdout, or null when it failed (with why in `failure`). */
  run(command: readonly string[]): Promise<{ stdout: string; failure: string | null }>;
  log(message: string): void;
}

/** Start the Secret Service; the variables clients need, for the session environment. */
export async function startKeyring(deps: KeyringDeps): Promise<Record<string, string>> {
  if (!deps.which("gnome-keyring-daemon")) {
    deps.log("no gnome-keyring-daemon: apps that store passwords will have no Secret Service");
    return {};
  }
  const { stdout, failure } = await deps.run(["gnome-keyring-daemon", "--start", "--components=secrets"]);
  if (failure) {
    deps.log(`gnome-keyring-daemon failed (${failure}); apps that store passwords may have no Secret Service`);
    return {};
  }
  const environment = parseKeyringEnvironment(stdout);
  if (!(KEYRING_VARIABLE in environment)) deps.log("gnome-keyring-daemon is running, but reported no control socket");
  else deps.log("Secret Service started (gnome-keyring)");
  return environment;
}
