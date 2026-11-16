/** The rewriter of a machine with no model: every transcript comes back unchanged (docs/dictation-rewrite.md, "The stand-in"). */

import type { Rewriter } from "./types.ts";

export const noRewriter: Rewriter = {
  rewrite: async () => ({ kind: "unchanged", timings: { totalMs: 0, firstTokenMs: null, tokens: 0 } }),
  warm() {},
  state: () => "no-model",
  advice: () => ({ land: "once", deadlineMs: 0 }),
};
