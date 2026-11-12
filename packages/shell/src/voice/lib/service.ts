/** The connection to dashi-voice, made when first needed and again after it goes: one place events come from. */

import type { VoiceLink } from "../client.ts";
import type { VoiceEvent } from "./wire.ts";

/** What a request is refused with while the service can't be reached. */
export const NOT_RUNNING = "Voice isn't running in this session. Log out and in again to start it.";

export class VoiceService {
  private link: VoiceLink | null = null;
  private connecting: Promise<VoiceLink | null> | null = null;
  private readonly listeners = new Set<(event: VoiceEvent) => void>();
  private readonly linkListeners = new Set<(connected: boolean) => void>();
  private closed = false;

  constructor(private readonly connect: () => Promise<VoiceLink | null>) {}

  get connected(): boolean {
    return this.link !== null;
  }

  /** The link, connecting if there is none; null when the service isn't there. */
  get(): Promise<VoiceLink | null> {
    if (this.link || this.closed) return Promise.resolve(this.link);
    this.connecting ??= this.connect()
      .catch(() => null)
      .then((link) => {
        this.connecting = null;
        if (!link) return null;
        if (this.closed) {
          link.close();
          return null;
        }
        this.link = link;
        link.on((event) => {
          for (const listener of [...this.listeners]) listener(event);
        });
        link.onClosed(() => {
          if (this.link !== link) return;
          this.link = null;
          this.tell(false);
        });
        this.tell(true);
        return link;
      });
    return this.connecting;
  }

  private tell(connected: boolean): void {
    for (const listener of [...this.linkListeners]) listener(connected);
  }

  /** Ask the service; rejects with words for the person. */
  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const link = await this.get();
    if (!link) throw new Error(NOT_RUNNING);
    return link.call(method, params);
  }

  on(listener: (event: VoiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The service came (true) or went (false). */
  onLink(listener: (connected: boolean) => void): () => void {
    this.linkListeners.add(listener);
    return () => this.linkListeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.link?.close();
    this.link = null;
  }
}
