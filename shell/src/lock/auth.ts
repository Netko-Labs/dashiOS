/**
 * Checking the person's password for the lock screen, without root and
 * without linking PAM: Linux-PAM's setuid helper `unix_chkpwd` checks the
 * calling user's own password (read from stdin, NUL-terminated) and exits 0
 * when it matches. That's the same check pam_unix makes for a screen locker.
 *
 * Misses slow down: after three, each try waits longer (up to 30 s).
 */

import { userInfo } from "node:os";

const HELPERS = ["/usr/sbin/unix_chkpwd", "/usr/bin/unix_chkpwd", "/sbin/unix_chkpwd"];

/** The account that is locked out. */
export function lockedUser(): string {
  return process.env.USER || userInfo().username;
}

/** The name the lock screen greets: the account's full name, else its login. */
export async function displayName(user: string): Promise<string> {
  try {
    const getent = Bun.spawn(["getent", "passwd", user], { stdout: "pipe", stderr: "ignore" });
    const line = (await new Response(getent.stdout).text()).trim();
    const gecos = line.split(":")[4]?.split(",")[0]?.trim();
    return gecos || user;
  } catch {
    return user;
  }
}

async function findHelper(): Promise<string | null> {
  for (const path of HELPERS) {
    if (await Bun.file(path).exists()) return path;
  }
  return null;
}

/** Whether `password` is `user`'s. Never throws; a missing helper is a no. */
export async function checkPassword(user: string, password: string): Promise<boolean> {
  const helper = await findHelper();
  if (!helper || password.includes("\0")) return false;
  try {
    // The password goes in as a blob, written before the helper reads: Bun's
    // stdin pipes are non-blocking, and unix_chkpwd reads once, so a pipe
    // written after spawn can look empty to it ("no password supplied").
    const child = Bun.spawn([helper, user, "nullok"], {
      stdin: new Blob([`${password}\0`]),
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await child.exited) === 0;
  } catch {
    return false;
  }
}

/** How long to wait before the next try after `misses` wrong passwords. */
export function backoffMs(misses: number): number {
  if (misses < 3) return 0;
  return Math.min(1000 * 2 ** (misses - 3), 30_000);
}
