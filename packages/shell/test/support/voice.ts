/** A dashi-voice that answers from a script, and timers a test moves by hand (voice/). */

import type { VoiceLink } from "../../src/voice/index.ts";
import { VoiceService } from "../../src/voice/lib/service.ts";
import type { VoiceEvent } from "../../src/voice/lib/wire.ts";

type Reply = unknown | ((params: Record<string, unknown>) => unknown);

export interface FakeVoice {
  service: VoiceService;
  /** Every call made, in order: "listen", "speak:Hello." */
  calls: string[];
  /** What a method answers; an Error is its refusal. Unlisted methods answer `{}`. */
  replies: Record<string, Reply>;
  emit(event: VoiceEvent): void;
  /** The service goes away. */
  drop(): void;
}

export function fakeVoice(replies: Record<string, Reply> = {}): FakeVoice {
  const calls: string[] = [];
  const listeners = new Set<(event: VoiceEvent) => void>();
  const closed = new Set<() => void>();
  const link: VoiceLink = {
    async call(method, params = {}) {
      calls.push(typeof params.text === "string" ? `${method}:${params.text}` : Array.isArray(params.sets) ? `${method}:${params.sets.join("+")}` : method);
      const reply = fake.replies[method];
      if (reply instanceof Error) throw reply;
      return typeof reply === "function" ? reply(params) : (reply ?? {});
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClosed(listener) {
      closed.add(listener);
      return () => closed.delete(listener);
    },
    close() {},
  };
  const fake: FakeVoice = {
    service: new VoiceService(async () => link),
    calls,
    replies,
    emit: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
    drop: () => {
      for (const listener of [...closed]) listener();
    },
  };
  return fake;
}

/** Timers a test moves: `advance(ms)` runs what came due, in order. */
export function handTimers(): { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void; advance(ms: number): void } {
  let now = 0;
  let pending: Array<{ at: number; run: () => void }> = [];
  return {
    set(run, ms) {
      const timer = { at: now + ms, run };
      pending.push(timer);
      return timer;
    },
    clear(handle) {
      pending = pending.filter((timer) => timer !== handle);
    },
    advance(ms) {
      now += ms;
      for (;;) {
        const due = pending.filter((timer) => timer.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) return;
        pending = pending.filter((timer) => timer !== due);
        due.run();
      }
    },
  };
}
