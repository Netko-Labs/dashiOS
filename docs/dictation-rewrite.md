# The model that corrects dictation

The seam between dictation (`packages/shell/src/dictation/`, which owns the rules, the
gate, the fit, the insertion record) and the small model on this computer that rewrites
a transcript (`packages/shell/src/rewrite/`, which owns the model, its server, its
prompt and the checks on what it answers). Dictation calls one function. Everything
works with no model at all: the stand-in answers "unchanged".

Status: **the seam is settled; the numbers and the serving are filled in below as they
are measured** (`dashi-0.9.0-review/24-rewrite/README.md`).

## The call

```ts
import { type Rewriter, type RewriteRequest, type RewriteReply } from "../rewrite/index.ts";
```

```ts
export interface Rewriter {
  /** Never rejects and never takes longer than the request's deadline (plus a few ms). */
  rewrite(request: RewriteRequest): Promise<RewriteReply>;
  /**
   * The dictation key went down: have the model in memory by the time it comes up.
   * Costs nothing when it is there already, and does nothing when there is no model,
   * the machine is too slow, or rewriting is off. Never throws.
   */
  warm(): void;
  /** What the capsule and Settings can say without asking the server. */
  state(): RewriteState;
  /** How dictation should wait on this machine (from the one-time speed test). */
  advice(): RewriteAdvice;
}
```

### The request

```ts
export interface RewriteRequest {
  /**
   * The words after the rules (stage 1): what lands if the model does not answer.
   * Line breaks the rules made ("new line") are kept as "\n".
   */
  transcript: string;
  /**
   * The languages the person dictates in, the likeliest first, as BCP 47 primary tags
   * ("en", "es"). Empty when not known. The model is told to keep whichever language or
   * mix the transcript is in; a language the model is switched off for (see "Languages")
   * answers `off`.
   */
  languages: readonly string[];
  /**
   * The active vocabulary, the most relevant first: names as they should be written
   * ("Claude Code", "Dashi", "Wispr Flow"). The first 50 are used.
   */
  vocabulary: readonly string[];
  /** The text before the caret, "" when not known. The last 200 characters are used. */
  before: string;
  /** The profile's tone line, one short sentence, "" for none ("Casual, short sentences."). */
  tone: string;
  /** Milliseconds from this call to the reply. At the deadline the reply is `deadline`. */
  deadlineMs: number;
  /** Aborting it ends the call at once with `gone` (the person pressed Raw, or moved on). */
  signal?: AbortSignal;
}
```

What dictation must not do: put the vocabulary, the caret text or the tone inside
`transcript`. Each has its place in the prompt, and the transcript is the only part the
model is told to treat as words to type, never as instructions.

### The reply

```ts
export type RewriteReply =
  | { kind: "text"; text: string; timings: RewriteTimings }
  | { kind: "unchanged"; timings: RewriteTimings }
  | { kind: "failed"; why: RewriteFailure; detail: string; timings: RewriteTimings };

export type RewriteFailure =
  | "off" //        rewriting is turned off, or off for this language
  | "no-model" //   the model is not on this computer (Settings › Voice fetches it)
  | "too-slow" //   the speed test said this machine cannot answer in time
  | "starting" //   the server is not up yet, or the model is still loading
  | "deadline" //   no whole answer by the deadline
  | "refused" //    the answer failed a check (detail names the check)
  | "gone"; //      the server went away, the call was aborted, or it answered nonsense

export interface RewriteTimings {
  /** From the call to the reply. */
  totalMs: number;
  /** From the call to the model's first token; null when none came. */
  firstTokenMs: number | null;
  /** Tokens the model wrote. */
  tokens: number;
}
```

- `text`: land `text`. It passed every check ("The checks").
- `unchanged`: the model read it and changed nothing (its answer equals the transcript
  but for spaces). Land the transcript.
- `failed`: land the transcript. `why` is for the capsule's line and the history;
  `detail` is for a log, not for the person.

Only `text` ever differs from what the rules gave, so "what changed" (the capsule's
"2 fixes · Undo · Raw") is a comparison of `transcript` and `text`, made by dictation.

### State and advice

```ts
export type RewriteState = "off" | "no-model" | "too-slow" | "asleep" | "starting" | "ready";

export interface RewriteAdvice {
  /** "once": wait for the model, then land. "refine": land the rules' text, then replace it. */
  land: "once" | "refine";
  /** The deadline to pass on this machine. */
  deadlineMs: number;
}
```

`asleep` is a model that is here but not in memory (dropped after idle): `warm()` or a
`rewrite` wakes it, and a `rewrite` that arrives first answers `starting`.

"refine" is dictation's to carry out, because it owns the insertion record: land the
transcript, call `rewrite` with the longer deadline, and replace the landed text only if
the field still ends with it. The rewriter only says which of the two this machine can
afford.

## The stand-in

Until the real one is merged, and on a machine without a model:

```ts
export const noRewriter: Rewriter = {
  rewrite: async () => ({ kind: "unchanged", timings: { totalMs: 0, firstTokenMs: null, tokens: 0 } }),
  warm() {},
  state: () => "no-model",
  advice: () => ({ land: "once", deadlineMs: 0 }),
};
```

`rewrite/index.ts` exports it, so dictation's tests need nothing else.

## Who calls what, when

1. Key down: dictation calls `warm()`.
2. Key up: the rules run. The gate (dictation's) decides whether the model is asked. It
   should ask when there is a self-correction cue, a list marker, a long run with no
   punctuation, a word that is not a word, a vocabulary term's near-miss, or a profile
   that asks for polish; and not ask for a short, clean sentence: the model can only
   make that worse.
3. Dictation calls `rewrite` with `advice().deadlineMs`, shows "tidying" after 300 ms,
   and lands what the reply says.
4. Raw, or the person moving on: abort the signal.

## The checks

Made on the model's answer before it is given back; a failed one is `refused` with the
check's name in `detail`:

| Name | What it refuses |
| --- | --- |
| `empty` | nothing, or only spaces |
| `tags` | prompt tags or a chat role in the answer (`<transcript>`, `<|im_start|>`, "Assistant:") |
| `longer` | an answer much longer than the transcript |
| `lines` | a different number of line breaks |
| `overlap` | too few of the answer's words were in the transcript (it answered, obeyed or translated) |
| `numbers` | a number that was said is gone and no correction cue came before it |
| `vocabulary` | a vocabulary term that was in the transcript is gone and no cue came before it |

The floors, and what each check costs in good rewrites wrongly refused, are measured on
the evaluation set and written here once they are.

## Languages

English and Spanish, and a sentence that mixes both. If the model scores below "do
nothing" for a language on the evaluation set, it is off for that language: a request
whose first language is that one answers `failed: off`.

## The model, its server, the fetch

Filled in after the measurements: which model and quantisation, on which device, the
deadline, land once or refine; the process (llama.cpp's `llama-server`, MIT, on a Unix
socket in the runtime directory, started when dictation is first used, dropped after
idle); the fetch from Settings › Voice with its size and licence; the one-time speed
test.

## The evaluation set

`packages/shell/test/fixtures/dictation-rewrite/`: pairs of what the recogniser gave and
what should land, each with its tags and language, and the scorer (restraint, edit
accuracy, content damage; per tag and per language; "do nothing" and the rules as
baselines).
