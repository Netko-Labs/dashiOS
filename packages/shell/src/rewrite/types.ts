/** The seam between dictation and the model that rewrites a transcript (docs/dictation-rewrite.md). */

export interface RewriteRequest {
  /** The words after the rules: what lands if the model does not answer. Line breaks are "\n". */
  transcript: string;
  /** The languages the person dictates in, the likeliest first ("en", "es"); empty when not known. */
  languages: readonly string[];
  /** The active vocabulary, the most relevant first, as it should be written. The first 50 are used. */
  vocabulary: readonly string[];
  /** The text before the caret, "" when not known. The last 200 characters are used. */
  before: string;
  /** The profile's tone line, one short sentence, "" for none. */
  tone: string;
  /** Milliseconds from the call to the reply. */
  deadlineMs: number;
  /** Aborting it ends the call at once with `gone`. */
  signal?: AbortSignal;
}

export interface RewriteTimings {
  /** From the call to the reply. */
  totalMs: number;
  /** From the call to the model's first token; null when none came. */
  firstTokenMs: number | null;
  /** Tokens the model wrote. */
  tokens: number;
}

export type RewriteFailure = "off" | "no-model" | "too-slow" | "starting" | "deadline" | "refused" | "gone";

export type RewriteReply =
  | { kind: "text"; text: string; timings: RewriteTimings }
  | { kind: "unchanged"; timings: RewriteTimings }
  | { kind: "failed"; why: RewriteFailure; detail: string; timings: RewriteTimings };

export type RewriteState = "off" | "no-model" | "too-slow" | "asleep" | "starting" | "ready";

export interface RewriteAdvice {
  /** "once": wait for the model, then land. "refine": land the rules' text, then replace it. */
  land: "once" | "refine";
  /** The deadline to pass on this machine. */
  deadlineMs: number;
}

export interface Rewriter {
  /** Never rejects, and never takes longer than the request's deadline. */
  rewrite(request: RewriteRequest): Promise<RewriteReply>;
  /** The dictation key went down: have the model in memory by the time it comes up. */
  warm(): void;
  state(): RewriteState;
  /** How dictation should wait on this machine; for this transcript, when given (a long one is refined, not waited for). */
  advice(transcript?: string): RewriteAdvice;
}
