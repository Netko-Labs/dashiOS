# The model that corrects dictation

The seam between dictation (`packages/shell/src/dictation/`, which owns the rules, the
gate, the fit, the insertion record) and the small model on this computer that rewrites
a transcript (`packages/shell/src/rewrite/`, which owns the model, its server, its
prompt and the checks on what it answers). Dictation calls one function. Everything
works with no model at all: the stand-in answers "unchanged".

The decision in one paragraph (decisions.md D170 to D176; the tables are in
`dashi-0.9.0-review/24-rewrite/README.md`): the model is **SpeakoFlow Mini** (0.8B,
Apache-2.0, 542 MB at Q4), told what to do by **Dashi's own prompt** and held by **Dashi's
own checks**; it runs **on the processor**, in llama.cpp's server, on a Unix socket; a
sentence lands **once**, under **1.2 s**, and a long dictation lands by rule and is
refined. It is used for English, Spanish and a mix of both.

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
  /**
   * How dictation should wait on this machine (from the one-time speed test). Given the
   * transcript, the advice is for that transcript: a long one is refined, not waited for.
   */
  advice(transcript?: string): RewriteAdvice;
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

On a machine without a model, and in tests:

```ts
export const noRewriter: Rewriter = {
  rewrite: async () => ({ kind: "unchanged", timings: { totalMs: 0, firstTokenMs: null, tokens: 0 } }),
  warm() {},
  state: () => "no-model",
  advice: () => ({ land: "once", deadlineMs: 0 }),
};
```

`rewrite/index.ts` exports it, so dictation's tests need nothing else.

## Wiring it in

One rewriter for the session, made where dictation is started (`boot/dictation.ts`,
`correcting`), and handed to dictation as `rewriter`:

```ts
const rewriter = startRewriter({ tidy: () => voice.on === true && dictation.tidy !== false });
// dictation calls rewriter.warm() on the key and rewriter.rewrite(…) after its gate;
// Voice or "Tidy what I say" turned off, and the shell ending: rewriter.stop().
```

`startRewriter` is the real one when llama-server and the model's file are on this
computer, and answers `no-model` otherwise: dictation then asks nothing and lands the
rules' words (`dictation/lib/rewrite.ts`, `usable`). Dictation's types for the seam are
this module's (`rewrite/types.ts`); it declares none of its own.

## Who calls what, when

1. Key down: dictation calls `warm()`.
2. Key up: the rules run. The gate (dictation's, `dictation/lib/gate.ts`, D190) decides
   whether the model is asked: when a cue this set was scored on comes after something
   said ("no, I mean", ", no,", "actually", "sorry", "digo", "perdón", "mejor dicho", "o
   sea, no", "quise decir", "espera", "miento"…), something is said twice, a long run has
   no punctuation, a word begins a vocabulary term's heard form, or the profile asks for
   polish. Not for a list marker or a word that is not a word (the rules' own), and not
   for a short, clean sentence: the model can only make that worse.
3. Dictation calls `rewrite` with `advice().deadlineMs`, shows "tidying" after 300 ms,
   and lands what the reply says.
4. Raw, or the person moving on: abort the signal.

## The checks

Made on the model's answer before it is given back (`rewrite/checks.ts`); a failed one is
`refused` with the check's name in `detail`, and the rules' text lands. A rewrite may take
words out and mend a few; it may not answer, obey, translate, grow, or lose what the
person did not take back.

| Name | What it refuses |
| --- | --- |
| `empty` | nothing, or no words |
| `tags` | prompt tags or a chat role left in the answer (`<transcript>`, `<|im_start|>`, "Assistant:"); the whole message given back around the answer is taken off first |
| `longer` | more than two words longer than the transcript |
| `lines` | a different number of line breaks (the model does not lay out lists or letters) |
| `overlap` | under 70% of the answer's words were said (or are one slip from a word that was, or the same number in the other language): it answered, obeyed or translated |
| `repeated` | a word of four letters or more said more often than the speaker said it ("the blue one, actually the green one" as "the green one, actually the green one"): the correction was copied in, not carried out (found in the VM, `27-dictation-join`) |
| `opening` | a cue the sentence opens with is gone ("No, thank you" as "Thank you"): nothing came before it, so it took nothing back |
| `earlier` | what was said after the last cue is not all there: the answer kept the version that was taken back ("at five, no, six" as "at five") |
| `quotes` | words inside quotation marks changed |
| `numbers` | a number that was said is gone and no cue came after it |
| `negation` | a "don't" or a "shouldn't" (even one that lost its ending in recognition, "shouldt") became no "not" at all |
| `vocabulary` | a vocabulary term that was in the transcript is gone and no cue came after it |
| `dropped` | with no cue anywhere, words went that were not said again (a sentence left out, not a phrase started again) |

A cue is a word that can take back what came before it ("no", "actually", "wait",
"sorry", "I mean", "scratch that", "digo", "perdón", "mejor dicho", "quise decir", "o
sea"…; `rewrite/lib/words.ts`).

What they cost and what they buy, on the evaluation set with the shipped model: with no
checks the model damages 6.5% of all sentences and keeps 96.5% of the
right ones; with them, 1.6% (2.4% on the processor) and 98.6%. They refuse 24 of 370
answers, 4 of which were good rewrites (two letters the model laid out on three
lines, one filler sentence, one "only" the speaker added while correcting).

## Languages

English, Spanish, and a sentence that mixes both: the model beats both baselines in each
(self-corrections fixed, close match: 76% English, 75% Spanish, 88%
mixed; the rules alone fix about one in ten). No language is switched off. `offFor` in
`createRewriter` is where one would be: a request whose first language is in it answers
`failed: off`. Other languages are not measured; the model was trained to keep the
language it is given, and the `overlap` check refuses a translation.

## The model

**SpeakoFlow Mini** (`SpeakoFlow/speakoflow-mini`, Apache-2.0), a fine-tune of Qwen3.5
0.8B (Alibaba Cloud, Apache-2.0) made for exactly this job, at 4-bit quantisation
(`SpeakoFlow-Mini-0.8B-Q4_K_M.gguf`, 541 903 616 bytes, pinned by commit and SHA-256 in
`crates/dashi-voice/src/models/manifest.rs`). Why this one, with the numbers of all seven
candidates, is D170.

- **Its prompt is Dashi's** (`rewrite/prompt.ts`), not the one it was trained with: seven
  rules, then fifteen examples as turns (English, Spanish, mixed; the later version kept, a
  phrase started again, a chain of corrections; seven that change nothing). The part that
  never changes comes first, so the server keeps it evaluated: a dictation costs only its
  own words. Then, in the last message, the vocabulary, the tone and the text before the
  caret, each on its line, and the transcript between tags. With its own prompt the model
  fixes a little more but changes one right sentence in seven; with Dashi's, one in seventy
  (D173).
- **The tone and the text before the caret are not sent to this model** (`MODEL.context`
  in `rewrite/lib/model.ts`): with them it fixed fewer self-corrections (67% of the English
  ones, not 76%). The seam carries them for a model that takes them; the vocabulary is
  always sent.
- **What it does not do**, and the rules must: fix words that are not words ("dot" for
  "don't": 5%), take out "like" as a filler (9%), write vocabulary names where the heard
  form is other real words ("cloud code": 39%). Replacements, the contraction rule and
  fillers by position are dictation's stage 1 (`docs/voice.md`, "Tidying by rule").
- **The model does not lay out lists.** "First… second… third…" stays a sentence; lists
  are the rules' and the profile's (D174).

## The server

llama.cpp's `llama-server` (MIT), a separate program: Dashi starts it and talks to it,
and links nothing of it. The package is `dashi-llama` (`spin/rpm/dashi-llama.spec`), which
installs it at `/usr/libexec/dashi/llama/llama-server`; Fedora's own `llama-cpp` is too
old for this model (D172). It is built from the commit the measurements used
(`b1b770d90d94…`, build 12359, checked by SHA-256), **for the processor only**: no Vulkan
backend, no web UI, no OpenSSL, nothing fetched while it builds (D191). `spin/build-rpms
dashi-llama` builds it on the laptop in about two minutes. `DASHI_REWRITE_SERVER` names
another one (a checkout).

- **A unit of the person's session**, `dashi-rewrite`, started by the shell with
  `systemd-run --user` (`rewrite/lib/service.ts`) when the dictation key first goes down,
  and stopped after ten minutes with nothing asked, when Voice is turned off, and with
  the session (`PartOf=dashi-session.target`). Nothing runs before the first dictation.
- **A Unix socket**, `$XDG_RUNTIME_DIR/dashi-rewrite.sock` (`DASHI_REWRITE_SOCKET` puts
  it elsewhere), mode 0600 (`UMask=0077`). No TCP port is opened, and the unit may use no
  network at all (`RestrictAddressFamilies=AF_UNIX`). No core dumps (`LimitCORE=0`): they
  would hold what was said. Its log is kept nowhere (`StandardOutput=null`,
  `StandardError=null`; `DASHI_REWRITE_LOG=1` keeps it in the journal, for a checkout): it
  names no word, but it says when and how much. `NoNewPrivileges`, `Nice=5`.
- **On the processor**, half the threads and eight at most (D171). The packaged server
  has no graphics backend, so `DASHI_REWRITE_DEVICE=gpu` changes nothing with it; with a
  server built with Vulkan (`DASHI_REWRITE_SERVER`) it tries a graphics card, and the
  NVIDIA card is still never used for this (`VK_LOADER_DRIVERS_DISABLE`).
- **Warm while in use.** The server starts (if it is not up), waits for the model, and has
  it read the fixed part of the prompt 15 s after login when Voice and tidying are on, as
  soon as they are turned on, and when the key goes down (`boot/corrections.ts`
  `warmWhenWanted`; D360): about 2 s on the development laptop, which a cold first
  dictation could not wait for (pass 37: `why=deadline`). It is dropped after 10 minutes
  with no call, as before; the next key down loads it again. After that each dictation
  costs its own words only.
- **What it holds:** 1 GB of memory while it is up, none of the graphics card's, no
  processor time while idle; nothing once it is stopped.
- The protocol is llama-server's own (`POST /v1/chat/completions`, streamed, temperature
  0, thinking off); `rewrite/lib/complete.ts` is the only code that speaks it.

## The fetch

The model is the set `rewrite` of dashi-voice (`docs/voice.md`, "The models"): fetched by
the same fetcher as the speech models (pinned commit, SHA-256, resumable), into
`~/.local/share/dashi/voice/rewrite/`, and removed the same way. **Settings › Voice** has
the row "Corrections" under the dictation rows: what it does, "Optional: 542 MB, fetched
once. The model is free to use and to share (Apache 2.0). Until it is here, dictation
tidies by rule.", Fetch with progress and Pause, and Remove. It is never fetched with the
basic sets or with "More languages", and only the person's own press fetches it.

Turning it off is removing it, or turning off "Tidy what I say" (`dictation.tidy`).

## The speed test

The first time the server comes up with a model it has not timed, the rewriter rewrites
one sentence of sixteen words three times and keeps the middle time in
`$XDG_STATE_HOME/dashi/rewrite-speed.json` (`rewrite/lib/speed.ts`). From it:

| The sixteen words took | What dictation does | Settings says |
| --- | --- | --- |
| up to 800 ms | lands once, under 1.2 s; a transcript long enough to take over 0.8 s lands by rule and is refined (deadline twice the expected time, 8 s at most) | nothing |
| 800 ms to 2.5 s | lands by rule and is refined, always | "It takes a moment here: your words land first, and are corrected right after." |
| over 2.5 s | the model is not used (`too-slow`) | "This computer is too slow for it, so dictation tidies by rule." |

On the development laptop the test says 236 ms: `advice()` is "once, 1200 ms" up to
about 54 words.

## The evaluation set

`packages/shell/test/fixtures/dictation-rewrite/*.jsonl`: 370 pairs of what the
recogniser gave (`heard`) and what should land (`want`, and `also` for other answers that
are as right), each with its language (192 English, 114 Spanish, 64 mixed) and tags.
`unsure` marks the 30-odd whose target a careful reader could argue with.

| File | Pairs | What |
| --- | --- | --- |
| `self-correction.jsonl` | 134 | "no, I mean", "actually", "wait", "sorry", "scratch that", "I meant", chains of attempts, a phrase started again; "no, digo", "perdón", "mejor dicho", "o sea, no", "quise decir"; and across languages |
| `restraint.jsonl` | 102 | sentences that are right and must come back untouched: plain ones, a real "no" or "actually" (`real-no`), quoted speech about corrections (`quoted`), the speaker's own second-language phrasing (`voice`) |
| `words.jsonl` | 55 | words that are not words and dropped contractions (`nonword`), fillers (`filler`), run-ons with no punctuation (`runon`) |
| `names.jsonl` | 20 | names given in a vocabulary, and sentences where the vocabulary must not be forced |
| `structure.jsonl` | 26 | lists (kept as sentences), and instructions planted in the transcript, which are typed and never obeyed (`injection`) |
| `corpus.jsonl` | 33 | every row of the owner's corpus (`dictation-corpus.md`), with the lead's "meant" as the target where it is sure |

Scored three ways, each alone (`test/support/rewrite-eval/score.ts`):

- **Restraint**: of the pairs that were already right, the share that came back to the letter.
- **Edit accuracy**: of the pairs needing a change, the share that came back as wanted;
  *exact* to the letter, *close* forgiving capitals and punctuation.
- **Content damage**: of all pairs, the share that lost a word the person said and that
  should have stayed.

per tag and per language, with two baselines: doing nothing (100%, 0%, 0%) and the rules
alone (`dictation/lib/tidy.ts`: 98.6%, 4.4% exact and 16.8% close, 0.3%).
`test/rewrite-score.test.ts` holds the set to its size and the baselines to their
numbers. To run a model through it:

```sh
llama-server -m MODEL.gguf --host /path/to/s.sock -ngl 0 -c 4096 -np 1 --no-webui -rea off &
bun packages/shell/test/support/rewrite-eval/run.ts --system model --socket /path/to/s.sock --out scores.json
```

## Tests

`packages/shell/test/rewrite-*.test.ts`: the checks, case by case; the rewriter against a
scripted server on a Unix socket (`test/support/rewrite-server.ts`): text, unchanged,
refused, what is and is not sent, the deadline, an abort, a server still loading, one that does not come up, off,
no model, too slow, the key starting it once, the idle stop; the unit's command; the
speed test's advice; the scorer and the set. `settings-voice-corrections.test.tsx`: the
row. `cargo test -p dashi-voice`: the set is pinned and sized.

## What it can't do yet

- Fix non-words, "like", or names heard as other words: stage 1's (above).
- Three self-corrections in ten are left as said (never made worse): the hard ones are a
  phrase started again with no cue ("Lo que pasa es que, el problema es que…") and the
  owner's rows 11 and 25. A Dashi fine-tune is the plan for these (D176).
- Tone and the text before the caret: taken by the seam, not used by this model (above).
- Gemma 4 E2B (3.1 GB) cleans more than this model does (non-words, fillers, names) and is
  as careful: the person may choose it in Settings › Voice, "Corrected by", as a second,
  larger fetch (set `rewrite-gemma`), or the rules alone, or Claude with their own key
  (D200).
- The integrated graphics card: the package is built for the processor only (D191).
