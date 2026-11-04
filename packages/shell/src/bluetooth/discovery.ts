/**
 * Looking for devices on behalf of the page: while it is open, the radio is
 * on, and the minute is not up. A scanning radio costs power and bandwidth
 * that audio shares, so the page does not look for longer than it has to;
 * when the minute is up it stops until the person asks again.
 */

import type { BluetoothBackend } from "./types.ts";

const DISCOVERY_MS = 60_000;

export class Discovery {
  /** The backend is looking because of this page (or about to be). */
  private looking = false;
  private starting = false;
  /** The minute is up: no more looking until `renew`. */
  private expired = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly backend: BluetoothBackend,
    /** Whether the page wants devices found right now. */
    private readonly wanted: () => boolean,
    /** Tells the page whether it is looking. */
    private readonly changed: (looking: boolean) => void,
    private readonly ms = DISCOVERY_MS,
  ) {}

  get active(): boolean {
    return this.looking;
  }

  /** A new minute: the page opened, the radio came back, or the person asked again. */
  renew(): void {
    this.expired = false;
  }

  /** Looks if it should and does not, stops if it should not and does. */
  sync(): void {
    const should = this.wanted() && !this.expired;
    if (should && !this.looking && !this.starting) void this.start();
    else if (!should && this.looking) void this.stop();
  }

  /** The backend is no longer looking, whatever the reason (the radio went off, BlueZ went away). */
  forget(): void {
    clearTimeout(this.timer);
    this.looking = false;
    this.changed(false);
  }

  async stop(): Promise<void> {
    this.forget();
    try {
      await this.backend.stopDiscovery();
    } catch {
      // Nothing left to stop; the radio is off or BlueZ is gone.
    }
  }

  private async start(): Promise<void> {
    this.starting = true;
    let started = true;
    try {
      await this.backend.startDiscovery();
    } catch {
      started = false;
    }
    this.starting = false;
    if (!started) return;
    this.looking = true;
    // The page closed or the radio went off while the request was out.
    if (!this.wanted() || this.expired) return void this.stop();
    this.timer = setTimeout(() => {
      this.expired = true;
      void this.stop();
    }, this.ms);
    this.changed(true);
  }
}
