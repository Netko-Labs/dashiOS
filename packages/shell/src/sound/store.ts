/**
 * The Sound page's outputs and which one is the default, as a store the page
 * subscribes to. Opening the page reads the list and keeps reading it, so an
 * output plugged in while the page is open shows up; closing stops that.
 *
 * Choosing an output shows it as the default at once, makes it the default,
 * and then reads the truth back. Reads that started before a choice are
 * dropped, and reads wait while one is in flight, so a poll cannot flip the
 * check back and forth. A choice that fails leaves the old default in place
 * and says which output it could not make the default.
 */

import { useSyncExternalStore } from "react";
import type { Output, SoundBackend } from "./types.ts";

/** How often the list is read while the page is open. */
export const SOUND_POLL_MS = 3000;

export interface SoundState {
  /** Null until the first read; false when PipeWire cannot be asked. */
  available: boolean | null;
  outputs: readonly Output[];
  /** The label of the output the last choice could not make the default. */
  failed: string | null;
}

const INITIAL: SoundState = { available: null, outputs: [], failed: null };

export interface SoundStoreOptions {
  /** For tests. */
  pollMs?: number;
}

export class SoundStore {
  private snapshot: SoundState = INITIAL;
  private readonly listeners = new Set<() => void>();
  /** Counts reads, so one that started before a choice cannot land after it. */
  private reads = 0;
  /** The output being made the default; reads wait for it. */
  private choosing: number | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly backend: SoundBackend,
    private readonly options: SoundStoreOptions = {},
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SoundState => this.snapshot;

  /** The page opened: read now, and keep reading until `close`. */
  open(): void {
    this.timer ??= setInterval(() => void this.refresh(), this.options.pollMs ?? SOUND_POLL_MS);
    void this.refresh();
  }

  close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    // An old failure is not news the next time the page opens.
    if (this.snapshot.failed !== null) this.publish({ failed: null });
  }

  async refresh(): Promise<void> {
    if (this.choosing !== null) return;
    const read = ++this.reads;
    const outputs = await this.backend.list().catch(() => null);
    if (read !== this.reads) return;
    this.publish(outputs === null ? { available: false, outputs: [] } : { available: true, outputs });
  }

  /** Makes `id` the default output. Choosing the current one, or one not listed, does nothing. */
  async choose(id: number): Promise<void> {
    const target = this.snapshot.outputs.find((output) => output.id === id);
    if (target === undefined || target.current || this.choosing !== null) return;
    this.reads++;
    this.choosing = id;
    this.publish({ outputs: this.snapshot.outputs.map((output) => ({ ...output, current: output.id === id })), failed: null });
    const ok = await this.write(id);
    this.choosing = null;
    if (!ok) this.publish({ failed: target.label });
    await this.refresh();
  }

  private async write(id: number): Promise<boolean> {
    try {
      return await this.backend.setDefault(id);
    } catch {
      return false;
    }
  }

  private publish(change: Partial<SoundState>): void {
    const next = { ...this.snapshot, ...change };
    // Replaced only on a change: useSyncExternalStore re-renders on every new object.
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function useSound(store: SoundStore): SoundState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
