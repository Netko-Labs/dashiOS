/**
 * The main thread's side of the reader worker (sampler.ts): `look` asks
 * for one look at /proc and resolves with it. Replies are matched to their
 * request by id, so a slow look can't be taken for a later one.
 */

import type { Snapshot } from "../../../src/shared/processes/read.ts";
import type { LookReply, LookRequest, LookWants } from "./sampler.ts";

export class Sampler {
  private readonly worker = new Worker(new URL("./sampler.ts", import.meta.url));
  private readonly waiting = new Map<number, { resolve: (snapshot: Snapshot) => void; reject: (error: Error) => void }>();
  private next = 0;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<LookReply>) => {
      const reply = event.data;
      const waiter = this.waiting.get(reply.id);
      if (!waiter) return;
      this.waiting.delete(reply.id);
      if ("error" in reply) waiter.reject(new Error(reply.error));
      else waiter.resolve(reply.snapshot);
    };
    this.worker.onerror = (event) => {
      const error = new Error(`the reader stopped: ${event.message}`);
      for (const waiter of this.waiting.values()) waiter.reject(error);
      this.waiting.clear();
    };
    // The window decides when the app ends, not the reader.
    this.worker.unref();
  }

  look = (options: LookWants): Promise<Snapshot> =>
    new Promise((resolve, reject) => {
      const id = ++this.next;
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ id, options } satisfies LookRequest);
    });

  close(): void {
    this.worker.terminate();
  }
}
