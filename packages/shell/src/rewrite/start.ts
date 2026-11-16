/**
 * The rewriter as the shell starts it: the real server when its program and
 * the model's file are on this computer, the rules alone otherwise.
 */

import { statSync } from "node:fs";
import { HOSTED_MODEL, hostedRewriter } from "./lib/hosted.ts";
import { type LocalModel, localModel, MODEL } from "./lib/model.ts";
import { modelPath, unitService } from "./lib/service.ts";
import { speedFile } from "./lib/speed-store.ts";
import { createRewriter } from "./rewriter.ts";
import { noRewriter } from "./stand-in.ts";
import type { CorrectionChoice, Rewriter } from "./types.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** Whether a model's file is here, whole. */
export function modelHere(env: Env = process.env, model: LocalModel = MODEL): boolean {
  try {
    return statSync(modelPath(env, model)).size === model.bytes;
  } catch {
    return false;
  }
}

export interface StartRewriter {
  /** Whether dictation tidies at all (settings.json `dictation.tidy`): off, nothing is rewritten. */
  tidy(): boolean;
  /** What corrects (settings.json `dictation.corrections`): SpeakoFlow Mini unless chosen otherwise. */
  choice?(): CorrectionChoice;
  /** Claude's key from Settings › Agents, for the choice "key". */
  key?(): Promise<string | null>;
  env?: Env;
}

export type SessionRewriter = Rewriter & {
  stop(): Promise<void>;
  /** The model that corrects now, for the logs ("speakoflow-mini-q4", "claude-haiku-5-5", "rules"). */
  model(): string;
};

/**
 * The session's rewriter: the one the choice names, each made once. A change of choice stops the model on this
 * computer that was running (one server at a time: the next dictation starts the chosen one). `stop()` stops it (the
 * shell ending, Voice turned off).
 */
export function startRewriter({ tidy, choice = () => "speakoflow", key, env = process.env }: StartRewriter): SessionRewriter {
  const made = new Map<CorrectionChoice, Rewriter & { stop?(): Promise<void> }>();
  let last: CorrectionChoice | null = null;
  const local = (model: LocalModel) =>
    createRewriter({
      service: unitService(env, model),
      model,
      usable: () => (tidy() ? (modelHere(env, model) ? "ok" : "no-model") : "off"),
      speed: speedFile(env, model),
    });
  const make = (chosen: CorrectionChoice): Rewriter & { stop?(): Promise<void> } => {
    const model = localModel(chosen);
    if (model) return local(model);
    return chosen === "key" && key ? hostedRewriter({ key }) : noRewriter;
  };
  const now = (): Rewriter & { stop?(): Promise<void> } => {
    const chosen = choice();
    if (last !== null && last !== chosen) void made.get(last)?.stop?.();
    last = chosen;
    const rewriter = made.get(chosen) ?? make(chosen);
    made.set(chosen, rewriter);
    return rewriter;
  };
  return {
    rewrite: (request) => now().rewrite(request),
    warm: () => now().warm(),
    state: () => (tidy() ? now().state() : "off"),
    advice: (transcript) => now().advice(transcript),
    stop: async () => {
      await Promise.all([...made.values()].map((rewriter) => rewriter.stop?.()));
    },
    model: () => {
      const chosen = choice();
      return localModel(chosen)?.name ?? (chosen === "key" ? HOSTED_MODEL : "rules");
    },
  };
}
