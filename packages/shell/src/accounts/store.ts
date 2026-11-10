/**
 * The Users & Accounts pane's state as a store: the current user, read when
 * the pane opens, and the changes the pane makes (a new name, a new picture,
 * automatic login), each showing what it is doing and why it failed. The
 * backend is read back after every change, so the pane shows what the system
 * has.
 */

import { useSyncExternalStore } from "react";
import type { Account, AccountsBackend, ChangeResult } from "../shared/accounts/index.ts";

export type AccountChange = "name" | "picture" | "login";

export interface AccountState {
  /** Null until the first read; false when AccountsService cannot be asked. */
  available: boolean | null;
  account: Account | null;
  /** What is being changed now. */
  busy: AccountChange | null;
  /** The last change that failed, and why. */
  failure: { change: AccountChange; message: string } | null;
}

const INITIAL: AccountState = { available: null, account: null, busy: null, failure: null };

export class AccountStore {
  private snapshot: AccountState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private reads = 0;

  constructor(private readonly backend: AccountsBackend) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AccountState => this.snapshot;

  async refresh(): Promise<void> {
    const read = ++this.reads;
    const account = await this.backend.read().catch(() => null);
    if (read !== this.reads) return;
    this.publish({ available: account !== null, account });
  }

  setRealName(name: string): Promise<boolean> {
    return this.change("name", () => this.backend.setRealName(name));
  }

  setIcon(path: string): Promise<boolean> {
    return this.change("picture", () => this.backend.setIcon(path));
  }

  setAutomaticLogin(on: boolean): Promise<boolean> {
    return this.change("login", () => this.backend.setAutomaticLogin(on));
  }

  dismissFailure(): void {
    if (this.snapshot.failure !== null) this.publish({ failure: null });
  }

  /** A failure that is not a change of the account (the picture chooser had nothing to offer). */
  fail(change: AccountChange, message: string): void {
    this.publish({ failure: { change, message } });
  }

  private async change(change: AccountChange, work: () => Promise<ChangeResult>): Promise<boolean> {
    if (this.snapshot.busy !== null) return false;
    this.publish({ busy: change, failure: null });
    let result: ChangeResult;
    try {
      result = await work();
    } catch {
      result = { ok: false, message: "Accounts can't be reached." };
    }
    await this.refresh();
    this.publish({ busy: null, ...(result.ok ? {} : { failure: { change, message: result.message } }) });
    return result.ok;
  }

  private publish(change: Partial<AccountState>): void {
    const next = { ...this.snapshot, ...change };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function useAccount(store: AccountStore): AccountState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
