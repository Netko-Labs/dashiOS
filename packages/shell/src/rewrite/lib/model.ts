/**
 * The model that rewrites (docs/dictation-rewrite.md, "The model";
 * decisions.md D170). Its file is fetched by dashi-voice as the set `rewrite`
 * (crates/dashi-voice/src/models/manifest.rs names the same file).
 */
export const MODEL = {
  /** The set's id in dashi-voice, and its folder under the models' folder. */
  set: "rewrite",
  file: "SpeakoFlow-Mini-0.8B-Q4_K_M.gguf",
  bytes: 541_903_616,
  /**
   * Whether the tone and the text before the caret are sent. Not to this model: with them it fixed
   * 67% of English self-corrections instead of 76% (docs/dictation-rewrite.md, "The model"). The
   * vocabulary is always sent.
   */
  context: false,
} as const;
