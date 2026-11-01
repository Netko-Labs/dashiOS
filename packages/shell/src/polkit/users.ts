/**
 * Who a uid is: the login to hand the helper and the name to show. Asked of
 * `getent passwd` so that accounts from sssd, LDAP, or systemd-homed count too.
 */

export interface PolkitUser {
  uid: number;
  /** The account name, safe to pass as an argument. */
  login: string;
  /** The full name when the account has one, else the login. */
  label: string;
}

/** What `passwd` allows in a login name, minus anything that could pass for an option. */
const LOGIN = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,63}$/;

/** `name:x:uid:gid:gecos:home:shell`; null for a line that is not that or names someone else. */
export function parsePasswd(line: string, uid: number): PolkitUser | null {
  const fields = line.trim().split(":");
  const login = fields[0] ?? "";
  if (fields.length < 7 || !LOGIN.test(login) || Number(fields[2]) !== uid) return null;
  const full = (fields[4] ?? "").split(",")[0]?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  return { uid, login, label: full || login };
}

export type LookupUser = (uid: number) => Promise<PolkitUser | null>;

export const lookupUser: LookupUser = async (uid) => {
  if (!Number.isInteger(uid) || uid < 0) return null;
  try {
    const getent = Bun.spawn(["getent", "passwd", String(uid)], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 5000 });
    const [line] = await Promise.all([new Response(getent.stdout).text(), getent.exited]);
    return parsePasswd(line, uid);
  } catch {
    return null;
  }
};
