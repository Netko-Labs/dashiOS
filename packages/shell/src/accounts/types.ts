/**
 * What the Users & Accounts pane is made of: the current user as
 * AccountsService describes them, and what a backend (AccountsService over
 * D-Bus, or the stand-in a development run gets) can change. A password is
 * never part of an account: it goes from the sheet to `PasswordChanger` and
 * nowhere else.
 */

export interface Account {
  uid: number;
  /** The login name. */
  userName: string;
  /** The full name; may be empty. */
  realName: string;
  /** The picture's path; null when the user has none. */
  iconFile: string | null;
  automaticLogin: boolean;
  administrator: boolean;
  /** How the account is signed into: it has a password the person can change here. */
  hasPassword: boolean;
}

/** A change that did not work, in words the pane can show. */
export type ChangeResult = { ok: true } | { ok: false; message: string };

export interface AccountsBackend {
  /** Null when AccountsService cannot be asked or does not know this user. */
  read(): Promise<Account | null>;
  setRealName(name: string): Promise<ChangeResult>;
  /** `path` is an absolute path to a PNG or JPEG; AccountsService copies it. */
  setIcon(path: string): Promise<ChangeResult>;
  /** Asks polkit to authenticate first (the shell's own agent shows the sheet). */
  setAutomaticLogin(on: boolean): Promise<ChangeResult>;
  close(): void;
}

export type PasswordFailure = "wrong-current" | "rejected" | "failed" | "timeout";

export type PasswordResult =
  | { ok: true }
  | {
      ok: false;
      reason: PasswordFailure /** A line from the system's password rules ("The password is too short."), never the password. */;
      message: string | null;
    };

export interface PasswordChanger {
  /** `current` is empty for an account that has no password yet. Never rejects. */
  change(current: string, next: string): Promise<PasswordResult>;
}
