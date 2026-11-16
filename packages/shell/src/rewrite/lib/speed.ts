/** The one-time speed test itself: the test sentence, three times, on a server that is up (speed-store.ts keeps what it finds). */

import { rewriteMessages } from "../prompt.ts";
import { complete } from "./complete.ts";
import { MODEL } from "./model.ts";
import { type Speed, TEST_SENTENCE } from "./speed-store.ts";

/** Times the test sentence three times on a server that is up; null when it did not answer. */
export async function measure(socket: string, now: () => number = () => performance.now()): Promise<Speed | null> {
  const messages = rewriteMessages({ transcript: TEST_SENTENCE, tone: "", vocabulary: [], before: "" });
  // Another sentence between the runs, so each timed one reads its own words again, as a dictation does.
  const between = rewriteMessages({ transcript: "Thanks, see you then.", tone: "", vocabulary: [], before: "" });
  const times: number[] = [];
  for (let run = 0; run < 3; run++) {
    if (!(await complete(between, { socket, deadlineMs: 20_000, maxTokens: 16, now })).ok) return null;
    const started = now();
    const done = await complete(messages, { socket, deadlineMs: 20_000, maxTokens: 64, now });
    if (!done.ok) return null;
    times.push(now() - started);
  }
  times.sort((a, b) => a - b);
  return { model: MODEL.file, ms: Math.round(times[1] ?? 0) };
}
