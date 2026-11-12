/**
 * A pretend account, for development runs: a nested shell must not rename
 * the developer's user, replace their picture, switch their automatic login,
 * or touch their password. Changes live in memory; the password is "dashi",
 * and the new one must be at least eight characters.
 */

import {
  type Account,
  type AccountsBackend,
  type ChangeResult,
  iconProblem,
  nameProblem,
  type PasswordChanger,
  type PasswordResult,
} from "../../shared/accounts/index.ts";

export class FakeAccounts implements AccountsBackend, PasswordChanger {
  private account: Account = {
    uid: 1000,
    userName: "dashi",
    realName: "Dashi User",
    iconFile: null,
    automaticLogin: false,
    administrator: true,
    hasPassword: true,
  };
  /** The current password; changing it works against this. */
  private password = "dashi";

  constructor(private readonly delayMs = 0) {}

  async read(): Promise<Account | null> {
    return { ...this.account };
  }

  private async wait(): Promise<void> {
    if (this.delayMs > 0) await Bun.sleep(this.delayMs);
  }

  async setRealName(name: string): Promise<ChangeResult> {
    await this.wait();
    const problem = nameProblem(name);
    if (problem !== null) return { ok: false, message: problem };
    this.account = { ...this.account, realName: name.trim() };
    return { ok: true };
  }

  async setIcon(path: string): Promise<ChangeResult> {
    await this.wait();
    const problem = iconProblem(path, null);
    if (problem !== null) return { ok: false, message: problem };
    this.account = { ...this.account, iconFile: path };
    return { ok: true };
  }

  async setAutomaticLogin(on: boolean): Promise<ChangeResult> {
    await this.wait();
    this.account = { ...this.account, automaticLogin: on };
    return { ok: true };
  }

  async change(current: string, next: string): Promise<PasswordResult> {
    await this.wait();
    if (current !== this.password) return { ok: false, reason: "wrong-current", message: null };
    if (next.length < 8) return { ok: false, reason: "rejected", message: "The password is shorter than 8 characters" };
    this.password = next;
    return { ok: true };
  }

  close(): void {}
}
