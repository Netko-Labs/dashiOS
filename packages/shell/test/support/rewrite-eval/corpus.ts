/**
 * The owner's corpus (test/fixtures/dictation-corpus.json, from dictation-corpus.md) through dictation as it is
 * joined: the rules, the gate, the model on a llama-server with Dashi's prompt and checks, the profile's style. One
 * line a row: what landed then, what lands now, and who changed it (the rules, the model, or nothing).
 *
 *   bun packages/shell/test/support/rewrite-eval/corpus.ts [--socket PATH]
 *
 * Without `--socket` nothing is asked: the rules alone. Nothing here runs in `bun run test`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { list, maybe, num, obj, optional, str } from "@dashi/shape";
import { Lexicon, systemWords } from "../../../src/dictation/index.ts";
import { compose } from "../../../src/dictation/lib/compose.ts";
import { withPauses } from "../../../src/dictation/lib/gate.ts";
import { PROFILES, pickProfile } from "../../../src/dictation/lib/profiles.ts";
import { reasonsFor, withModel } from "../../../src/dictation/lib/rewrite.ts";
import { checkAnswer } from "../../../src/rewrite/checks.ts";
import { rewriteMessages } from "../../../src/rewrite/prompt.ts";

const { values } = parseArgs({ options: { socket: { type: "string" } } });
const Corpus = obj({ rows: list(obj({ row: num(), landed: str(), by: str(), want: optional(str()) }, { strict: false })) }, { strict: false });
const corpus = maybe(Corpus, JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", "dictation-corpus.json"), "utf8")));
if (!corpus) throw new Error("the corpus fixture does not read");
const LOOSE = { strict: false };
const Completion = obj({ choices: list(obj({ message: obj({ content: str() }, LOOSE) }, LOOSE)) }, LOOSE);

const composing = {
  place: pickProfile(PROFILES, { window: 1, pid: 1, appId: "dev.dashi.editor" }, null),
  lexicon: new Lexicon({ memory: true }).getSnapshot(),
  words: systemWords(),
  tidy: true,
  agent: false,
};

async function ask(transcript: string, vocabulary: readonly string[]): Promise<string> {
  const response = await fetch("http://localhost/v1/chat/completions", {
    unix: values.socket,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: rewriteMessages({ transcript, tone: "", vocabulary, before: "" }), temperature: 0, max_tokens: 400, cache_prompt: true }),
  });
  return maybe(Completion, await response.json())?.choices[0]?.message.content ?? "";
}

console.log("row\tby (fixture)\tlanded then\tlands now\tchanged by\tgate\tmodel said");
for (const row of corpus.rows) {
  const made = compose(row.landed, composing);
  const reasons = reasonsFor(made, composing);
  let now = made.text;
  let model = "";
  if (values.socket && reasons.length > 0) {
    const vocabulary = made.terms.slice(0, 50).map((each) => each.term);
    const sent = withPauses(made.text);
    const checked = checkAnswer(sent, await ask(sent, vocabulary), vocabulary);
    model = checked.ok ? (checked.unchanged ? "unchanged" : "text") : `refused: ${checked.check}`;
    if (checked.ok && !checked.unchanged) now = withModel(made, checked.text, composing).text;
  }
  const by = now === row.landed ? "nothing" : now !== made.text ? "model" : "rules";
  console.log([row.row, row.by, row.landed, now, by, reasons.join(","), model].join("\t"));
}
