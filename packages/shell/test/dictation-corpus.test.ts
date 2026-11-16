/**
 * The owner's corpus (test/fixtures/dictation-corpus.json, from
 * dashi-0.9.0-design/assistant-v2/dictation-corpus.md): every row either
 * lands right by the rules alone, or is marked as waiting for the model,
 * with why the gate sends it there; a row that is the speaker's own way of
 * saying it lands untouched.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Infer, list, maybe, num, obj, optional, str } from "@dashi/shape";
import { Lexicon, wordsFrom } from "../src/dictation/index.ts";
import { compose } from "../src/dictation/lib/compose.ts";
import { PROFILES, pickProfile } from "../src/dictation/lib/profiles.ts";
import { reasonsFor } from "../src/dictation/lib/rewrite.ts";

const Corpus = obj({
  source: str(),
  rows: list(obj({ row: num(), landed: str(), by: str(), want: optional(str()), app: optional(str()), gate: optional(list(str())) })),
});
type Row = Infer<typeof Corpus>["rows"][number];

const read = maybe(Corpus, JSON.parse(readFileSync(join(import.meta.dir, "fixtures/dictation-corpus.json"), "utf8")));
if (!read) throw new Error("the corpus fixture does not read");
const corpus = read;

/** A dictionary with the corpus's own real words (hunspell's stems on a real machine). */
const real = new Set(corpus.rows.flatMap((row) => row.landed.toLowerCase().match(/[\p{L}']+/gu) ?? []));
for (const not of ["shouldt", "idead", "dashy", "whisperflow", "muy", "complicada"]) real.delete(not);
const words = wordsFrom([[...real].join("\n")]);
const lexicon = new Lexicon({ memory: true }).getSnapshot();
const said = (appId: string) => ({ place: pickProfile(PROFILES, { window: 1, pid: 1, appId }, null), lexicon, words, tidy: true, agent: false });
const composing = said("dev.dashi.editor");

const made = (row: Row) => compose(row.landed, row.app ? said(row.app) : composing);

test("every row of the corpus is accounted for", () => {
  expect(corpus.rows.map((row) => row.row)).toEqual(Array.from({ length: 61 }, (_, index) => index + 1));
  for (const row of corpus.rows) expect(["rules", "model", "voice", "unresolved"]).toContain(row.by);
});

for (const row of corpus.rows.filter((each) => each.by === "rules")) {
  test(`row ${row.row} lands right by the rules alone: ${row.want}`, () => {
    expect(made(row).text).toBe(row.want ?? "");
  });
}

for (const row of corpus.rows.filter((each) => each.by === "voice")) {
  test(`row ${row.row} is the speaker's own way of saying it, and lands untouched: ${row.landed}`, () => {
    const result = made(row);
    expect(result.text).toBe(row.landed);
    expect(reasonsFor(result, composing)).toEqual([]);
  });
}

for (const row of corpus.rows.filter((each) => each.by === "model")) {
  test(`row ${row.row} needs the model${row.gate?.length ? `, and the gate sends it (${row.gate.join(", ")})` : "; nothing in its words says so"}`, () => {
    const result = made(row);
    expect(reasonsFor(result, composing).map(String)).toEqual(row.gate ?? []);
  });
}

test("row 31, the owner quoting a correction, is not carried out by the rules", () => {
  const row = corpus.rows.find((each) => each.row === 31);
  expect(row && made(row).text).toBe(row?.landed);
});
