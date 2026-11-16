/**
 * The evaluation set through dictation as it is joined: the rules (compose), the gate, the model on a llama-server
 * with Dashi's prompt and checks, and the profile's style again. For each pair it says who put it right: the rules,
 * the model, or neither.
 *
 *   bun packages/shell/test/support/rewrite-eval/joined.ts --socket PATH [--set held-out] [--only TAG] [--all] [--out FILE.json]
 *
 * `--all` sends every sentence to the model (the gate ignored), to see what the gate costs and saves. Without
 * `--socket` nothing is asked: the rules alone. Nothing here runs in `bun run test`.
 */

import { join } from "node:path";
import { parseArgs } from "node:util";
import { list, maybe, obj, str } from "@dashi/shape";
import { Lexicon, systemWords } from "../../../src/dictation/index.ts";
import { compose } from "../../../src/dictation/lib/compose.ts";
import { withPauses } from "../../../src/dictation/lib/gate.ts";
import { PROFILES, pickProfile } from "../../../src/dictation/lib/profiles.ts";
import { reasonsFor, withModel } from "../../../src/dictation/lib/rewrite.ts";
import { checkAnswer } from "../../../src/rewrite/checks.ts";
import { rewriteMessages } from "../../../src/rewrite/prompt.ts";
import { FIXTURES, judge, loadPairs, type Pair } from "./score.ts";

const { values } = parseArgs({
  options: { socket: { type: "string" }, set: { type: "string" }, only: { type: "string" }, all: { type: "boolean", default: false }, out: { type: "string" } },
});

const LOOSE = { strict: false };
const Completion = obj({ choices: list(obj({ message: obj({ content: str() }, LOOSE) }, LOOSE)) }, LOOSE);

async function ask(transcript: string, vocabulary: readonly string[]): Promise<{ text: string; ms: number }> {
  const started = performance.now();
  const response = await fetch("http://localhost/v1/chat/completions", {
    unix: values.socket,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: rewriteMessages({ transcript, tone: "", vocabulary, before: "" }), temperature: 0, max_tokens: 400, cache_prompt: true }),
  });
  return { text: maybe(Completion, await response.json())?.choices[0]?.message.content ?? "", ms: performance.now() - started };
}

const composing = {
  place: pickProfile(PROFILES, { window: 1, pid: 1, appId: "dev.dashi.editor" }, null),
  lexicon: new Lexicon({ memory: true }).getSnapshot(),
  words: systemWords(),
  tidy: true,
  agent: false,
};

interface Row {
  id: string;
  tags: readonly string[];
  heard: string;
  want: string;
  ruled: string;
  landed: string;
  reasons: string[];
  /** What the model said of it: "" when not asked, "unchanged", "text", or the check that refused its answer. */
  model: string;
  ms: number;
  /** Who put it right; "right" needed nothing and got nothing, "broken" needed nothing and was changed. */
  by: "rules" | "model" | "neither" | "right" | "broken";
  damaged: boolean;
}

async function rowOf(pair: Pair): Promise<Row> {
  const made = compose(pair.heard, composing);
  const reasons = reasonsFor(made, composing);
  let landed = made.text;
  let model = "";
  let ms = 0;
  if (values.socket && (values.all || reasons.length > 0)) {
    const vocabulary = made.terms.slice(0, 50).map((each) => each.term);
    const sent = withPauses(made.text);
    const answer = await ask(sent, vocabulary);
    ms = answer.ms;
    const checked = checkAnswer(sent, answer.text, vocabulary);
    if (!checked.ok) model = checked.check;
    else {
      landed = checked.unchanged ? made.text : withModel(made, checked.text, composing).text;
      model = landed === made.text ? "unchanged" : "text";
    }
  }
  const right = (text: string): boolean => judge(pair, text).close;
  const whole = right(landed);
  const by = judge(pair, landed).noop ? (whole ? "right" : "broken") : !whole ? "neither" : right(made.text) ? "rules" : "model";
  return {
    id: pair.id,
    tags: pair.tags,
    heard: pair.heard,
    want: pair.want,
    ruled: made.text,
    landed,
    reasons,
    model,
    ms,
    by,
    damaged: judge(pair, landed).damaged,
  };
}

const pairs = loadPairs(values.set ? join(FIXTURES, values.set) : FIXTURES).filter(
  (pair) => !values.only || pair.tags.includes(values.only) || pair.lang === values.only,
);
const rows: Row[] = [];
for (const pair of pairs) rows.push(await rowOf(pair));

const groups = new Map<string, Row[]>();
for (const row of rows) for (const key of ["all", ...row.tags]) groups.set(key, [...(groups.get(key) ?? []), row]);
for (const [key, group] of groups) {
  const count = (by: Row["by"]): number => group.filter((row) => row.by === by).length;
  const asked = group.filter((row) => row.model !== "").length;
  const damaged = group.filter((row) => row.damaged).length;
  console.log(
    `${key.padEnd(22)} n=${String(group.length).padStart(3)}  right as heard ${count("right")}  broken ${count("broken")}  by rules ${count("rules")}  by model ${count("model")}  neither ${count("neither")}  asked ${asked}  damaged ${damaged}`,
  );
}
const times = rows
  .filter((row) => row.ms > 0)
  .map((row) => row.ms)
  .sort((a, b) => a - b);
const at = (q: number): number => Math.round(times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0);
console.log(`asked ${times.length} of ${rows.length}; time ms: median ${at(0.5)}  p90 ${at(0.9)}  max ${at(1)}`);
if (values.out) await Bun.write(values.out, JSON.stringify(rows, null, 1));
