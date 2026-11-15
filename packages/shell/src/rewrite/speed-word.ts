/**
 * The speed test's verdict in one word, for Settings › Voice. A file of its
 * own so the Settings app reads the state file without loading the rewriter.
 */

import { adviceFor, speedFile, tooSlow } from "./lib/speed-store.ts";

export type SpeedWord = "untimed" | "quick" | "refines" | "too-slow";

type Env = Readonly<Record<string, string | undefined>>;

export function speedWord(env: Env = process.env): SpeedWord {
  const speed = speedFile(env).read();
  if (speed === null) return "untimed";
  if (tooSlow(speed)) return "too-slow";
  return adviceFor(speed).land === "refine" ? "refines" : "quick";
}
