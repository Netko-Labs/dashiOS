/**
 * The model that corrects dictation as the session runs it (rewrite/; docs/dictation-rewrite.md): the one chosen in
 * Settings › Voice, "Corrections" (decisions.md D200), and a line in the session's log for each correction.
 */

import type { CorrectionChoice, RewriteReply, RewriteRequest, Rewriter, SessionRewriter } from "../rewrite/index.ts";
import { isCorrectionChoice, startRewriter } from "../rewrite/index.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import type { LateParts } from "./parts.ts";
import type { Late } from "./services.ts";

/** Each correction in the session's log: the model that made it, how long it took, and what came of it (no words). */
function logged(rewriter: SessionRewriter): SessionRewriter {
  const rewrite = rewriter.rewrite;
  return Object.assign(rewriter, {
    rewrite: async (request: RewriteRequest): Promise<RewriteReply> => {
      const reply = await rewrite(request);
      const why = reply.kind === "failed" ? ` why=${reply.why}` : "";
      console.error(`dashi-shell: dictation corrected model=${rewriter.model()} result=${reply.kind}${why} ms=${reply.timings.totalMs}`);
      return reply;
    },
  });
}

/**
 * The model that corrects what was dictated (rewrite/; docs/dictation-rewrite.md): its server and its file where they
 * are on this computer, the rules alone where they are not. Voice or tidying turned off takes it out of memory at once,
 * not after its idle time.
 */
export function correcting(settingsStore: SettingsStore, late: Late<LateParts>): Rewriter & { close(): void } {
  const wanted = (): boolean => {
    const { voice, dictation } = settingsStore.getSnapshot().data;
    return voice.on === true && dictation.tidy !== false;
  };
  const choice = (): CorrectionChoice => {
    const { corrections } = settingsStore.getSnapshot().data.dictation;
    return isCorrectionChoice(corrections) ? corrections : "speakoflow";
  };
  // Claude's key from Settings › Agents, only for the choice "key" (decisions.md D200).
  const key = async (): Promise<string | null> => (await late.peek("assistantHost")?.keys.anthropic())?.key ?? null;
  const rewriter = logged(startRewriter({ tidy: wanted, choice, key }));
  const stopWatching = settingsStore.subscribe(() => {
    if (!wanted()) void rewriter.stop();
  });
  return Object.assign(rewriter, {
    close: (): void => {
      stopWatching();
      void rewriter.stop();
    },
  });
}
