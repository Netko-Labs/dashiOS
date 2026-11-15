/**
 * The rewriter as the shell starts it: the real server when its program and
 * the model's file are on this computer, the rules alone otherwise.
 */

import { statSync } from "node:fs";
import { MODEL } from "./lib/model.ts";
import { modelPath, unitService } from "./lib/service.ts";
import { speedFile } from "./lib/speed.ts";
import { createRewriter } from "./rewriter.ts";
import type { Rewriter } from "./types.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** Whether the model's file is here, whole. */
export function modelHere(env: Env = process.env): boolean {
  try {
    return statSync(modelPath(env)).size === MODEL.bytes;
  } catch {
    return false;
  }
}

export interface StartRewriter {
  /** Whether dictation tidies at all (settings.json `dictation.tidy`): off, nothing is rewritten. */
  tidy(): boolean;
  env?: Env;
}

/** The session's rewriter. `stop()` stops the server (the shell ending, Voice turned off). */
export function startRewriter({ tidy, env = process.env }: StartRewriter): Rewriter & { stop(): Promise<void> } {
  return createRewriter({
    service: unitService(env),
    usable: () => (tidy() ? (modelHere(env) ? "ok" : "no-model") : "off"),
    speed: speedFile(env),
  });
}
