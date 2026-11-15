/**
 * What the one-time speed test found (docs/dictation-rewrite.md, "The speed
 * test"): how long this machine takes to rewrite one sentence of sixteen
 * words, kept in the state folder, and what that means for how dictation
 * waits. The test itself is speed.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { maybe, num, obj, str } from "@dashi/shape";
import type { RewriteAdvice } from "../types.ts";
import { MODEL } from "./model.ts";

/** The sentence timed: sixteen words, one correction in it. */
export const TEST_SENTENCE = "Tell Marcus the meeting moved to Thursday, no, I mean Friday, at ten in the morning.";
export const TEST_WORDS = 16;

/** One sentence a breath long must land within this, or dictation does not wait for the model. */
export const ONCE_MS = 1200;
/** Past this for the test sentence, the model is not used at all on this machine. */
export const TOO_SLOW_MS = 2500;
/** The longest a refinement is waited for. */
export const REFINE_MOST_MS = 8000;

export interface Speed {
  /** The model's file: a new model is timed again. */
  model: string;
  /** Milliseconds for the test sentence, the middle one of three. */
  ms: number;
}

const SpeedShape = obj({ model: str(), ms: num() });

export const tooSlow = (speed: Speed | null): boolean => speed !== null && speed.ms > TOO_SLOW_MS;

/** How long a transcript of `words` should take here: the test's time, by length. */
export const expectedMs = (speed: Speed, words: number): number => Math.round((speed.ms * Math.max(words, 4)) / TEST_WORDS);

/**
 * How dictation should wait for a transcript of `words` (the test sentence's length when not said).
 * Quick enough: wait and land once, with room to spare. Slower: land the rules' text and refine it.
 * Not timed yet: land once under the usual limit.
 */
export function adviceFor(speed: Speed | null, words: number = TEST_WORDS): RewriteAdvice {
  if (speed === null) return { land: "once", deadlineMs: ONCE_MS };
  const expected = expectedMs(speed, words);
  if (expected * 1.5 <= ONCE_MS) return { land: "once", deadlineMs: ONCE_MS };
  return { land: "refine", deadlineMs: Math.min(REFINE_MOST_MS, Math.max(ONCE_MS, expected * 2)) };
}

export interface SpeedStore {
  read(): Speed | null;
  write(speed: Speed): void;
}

type Env = Readonly<Record<string, string | undefined>>;

/** `$XDG_STATE_HOME/dashi/rewrite-speed.json`. */
export function speedFile(env: Env = process.env): SpeedStore {
  const file = join(env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state"), "dashi", "rewrite-speed.json");
  return {
    read: () => {
      try {
        const speed = existsSync(file) ? maybe(SpeedShape, JSON.parse(readFileSync(file, "utf8"))) : null;
        return speed && speed.model === MODEL.file ? speed : null;
      } catch {
        return null;
      }
    },
    write: (speed) => {
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(speed)}\n`);
      } catch {}
    },
  };
}
