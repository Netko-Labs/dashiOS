/**
 * A connection kept up for a client that lives as long as the shell: made on
 * first use, made again after the bus or the peer drops it (a few seconds
 * later, doubling up to a minute), with the client's subscriptions installed
 * on each new one. A service that is not running is not an error here; its
 * calls reject and the client decides what that means.
 */

import type { ConnectOptions } from "./connection.ts";
import { DBusConnection } from "./connection.ts";

/** What a `BusLink` needs of a connection (a `DBusConnection`; tests hand in a fake). */
export interface LinkedBus {
  readonly closed: boolean;
  onClose(listener: (error?: Error) => void): void;
  close(): void;
}

const FIRST_RETRY_MS = 3000;
const MAX_RETRY_MS = 60_000;

export class BusLink<B extends LinkedBus = DBusConnection> {
  private current: Promise<B> | null = null;
  private readonly setups = new Set<(bus: B) => Promise<void> | void>();
  private retry = FIRST_RETRY_MS;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly connect: () => Promise<B>) {}

  /** The system bus, through `DBusConnection`. */
  static system(options: ConnectOptions = {}): BusLink {
    return new BusLink(() => DBusConnection.connect({ bus: "system", ...options }));
  }

  /** The connection, connecting first if there is none. */
  bus(): Promise<B> {
    if (this.stopped) return Promise.reject(new Error("the bus link is closed"));
    this.current ??= this.open();
    return this.current;
  }

  /** Runs `setup` on this connection and every later one (subscriptions); the returned function stops that. */
  onConnect(setup: (bus: B) => Promise<void> | void): () => void {
    this.setups.add(setup);
    if (this.current) void this.current.then((bus) => setup(bus)).catch(() => {});
    else void this.bus().catch(() => this.schedule());
    return () => this.setups.delete(setup);
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    void this.current?.then((bus) => bus.close()).catch(() => {});
    this.current = null;
  }

  private async open(): Promise<B> {
    try {
      const bus = await this.connect();
      this.retry = FIRST_RETRY_MS;
      bus.onClose(() => {
        this.current = null;
        if (this.setups.size > 0) this.schedule();
      });
      for (const setup of [...this.setups]) {
        try {
          await setup(bus);
        } catch {
          // The service is not there yet; its own calls will say so.
        }
      }
      return bus;
    } catch (error) {
      this.current = null;
      throw error;
    }
  }

  private schedule(): void {
    if (this.stopped || this.timer !== undefined) return;
    const delay = this.retry;
    this.retry = Math.min(this.retry * 2, MAX_RETRY_MS);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.current && !this.stopped) void this.bus().catch(() => this.schedule());
    }, delay);
  }
}
