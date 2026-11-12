/**
 * What was said goes to Dashi's agent, the one the launcher asks: a spoken
 * ask is a launcher Ask task like a typed one (agents/ask/lib/tasks.ts), so
 * it is in the launcher's "Now", its plan waits for the person's own Return
 * there, and it is kept in the same history. Nothing a voice says runs a
 * plan: the launcher opens on it, and Return is still the person's hands.
 */

import { answerOf, NO_AGENT, SPOKEN_CONTEXT, type SpokenTask } from "./lib/answer.ts";
import type { Answer, Asker } from "./types.ts";

/** The launcher's Ask tasks, as much as a spoken ask needs. */
export interface SpokenTasks {
  ask(request: string, context?: string): string | null;
  get(id: string): SpokenTask | undefined;
  subscribe(listener: () => void): () => void;
  stop(id: string): void;
}

export function launcherAsker(tasks: () => SpokenTasks | null, showPlan: () => void): Asker {
  return {
    ask(words, signal) {
      const store = tasks();
      const id = store?.ask(words, SPOKEN_CONTEXT) ?? null;
      if (!store || id === null) return Promise.resolve(NO_AGENT);
      return new Promise<Answer>((resolve) => {
        let off = (): void => {};
        const look = (): void => {
          const task = store.get(id);
          const answer = task ? answerOf(task) : { say: "" };
          if (!answer) return;
          off();
          const { plan, ...rest } = answer;
          if (plan) showPlan();
          resolve(rest);
        };
        off = store.subscribe(look);
        signal.addEventListener(
          "abort",
          () => {
            off();
            store.stop(id);
            resolve({ say: "" });
          },
          { once: true },
        );
        look();
      });
    },
  };
}
