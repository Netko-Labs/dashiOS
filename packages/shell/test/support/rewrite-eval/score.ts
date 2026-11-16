/**
 * Scoring a system that rewrites transcripts, on the pairs in
 * test/fixtures/dictation-rewrite/ (docs/dictation-rewrite.md, "The
 * evaluation set"): restraint, edit accuracy and content damage, each alone,
 * per tag and per language.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bool, type Infer, int, list, must, obj, optional, str } from "@dashi/shape";

const Pair = obj({
  id: str(),
  lang: str(),
  tags: list(str()),
  heard: str(),
  want: str(),
  also: optional(list(str())),
  vocabulary: optional(list(str())),
  unsure: optional(bool()),
  corpus: optional(int()),
  note: optional(str()),
});
export type Pair = Infer<typeof Pair>;
const Pairs = list(Pair);

export const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "dictation-rewrite");

export function loadPairs(folder = FIXTURES): Pair[] {
  const rows: unknown[] = [];
  for (const name of readdirSync(folder).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(folder, name), "utf8").split("\n")) if (line.trim() !== "") rows.push(JSON.parse(line));
  }
  return must(Pairs, rows);
}

const strict = (text: string): string => text.trim().replace(/[ \t]+/g, " ");
/** Lower case, no marks: "Meet me at six." and "meet me at six" are the same answer. */
export const loose = (text: string): string =>
  (
    text
      .toLowerCase()
      .replace(/’/g, "'")
      .match(/[\p{L}\p{N}@]+(?:['.:][\p{L}\p{N}]+)*/gu) ?? []
  ).join(" ");
const words = (text: string): string[] => loose(text).split(" ").filter(Boolean);

export interface Verdict {
  /** Nothing had to change. */
  noop: boolean;
  /** The answer is the wanted text (or another accepted one), to the letter. */
  exact: boolean;
  /** The same, but for capitals and punctuation. */
  close: boolean;
  /** A word the person said, and that should stay, is gone. */
  damaged: boolean;
}

/** Whether `answer` lost a word that was both said and wanted in `wanted`. */
function lost(heard: string, wanted: string, answer: string): boolean {
  const left = words(answer);
  const said = words(heard);
  let damaged = false;
  for (const word of words(wanted)) {
    const at = said.indexOf(word);
    if (at < 0) continue;
    said.splice(at, 1);
    const found = left.indexOf(word);
    if (found < 0) damaged = true;
    else left.splice(found, 1);
  }
  return damaged;
}

export function judge(pair: Pair, answer: string): Verdict {
  const accepted = [pair.want, ...(pair.also ?? [])];
  const noop = strict(pair.want) === strict(pair.heard);
  const exact = accepted.some((text) => strict(text) === strict(answer));
  const close = exact || accepted.some((text) => loose(text) === loose(answer));
  // Damage is against the nearest accepted answer: one that lost nothing against any of them lost nothing.
  const damaged = !close && accepted.every((text) => lost(pair.heard, text, answer));
  return { noop, exact, close, damaged };
}

export interface Score {
  pairs: number;
  /** Of the pairs already right, the share that came back untouched; null when there are none. */
  restraint: number | null;
  /** Of the pairs needing a change, the share that came back exactly as wanted. */
  edit: number | null;
  /** The same, forgiving capitals and punctuation. */
  editClose: number | null;
  /** Of all the pairs, the share that lost a word the person said. */
  damage: number;
}

const share = (hits: number, of: number): number | null => (of === 0 ? null : hits / of);

export function score(verdicts: readonly Verdict[]): Score {
  const noops = verdicts.filter((verdict) => verdict.noop);
  const edits = verdicts.filter((verdict) => !verdict.noop);
  return {
    pairs: verdicts.length,
    restraint: share(noops.filter((verdict) => verdict.exact).length, noops.length),
    edit: share(edits.filter((verdict) => verdict.exact).length, edits.length),
    editClose: share(edits.filter((verdict) => verdict.close).length, edits.length),
    damage: verdicts.filter((verdict) => verdict.damaged).length / Math.max(1, verdicts.length),
  };
}

/** Scores for the whole set, and for each language and each tag. */
export function breakdown(pairs: readonly Pair[], answers: ReadonlyMap<string, string>): Map<string, Score> {
  const groups = new Map<string, Verdict[]>();
  const add = (key: string, verdict: Verdict): void => {
    groups.set(key, [...(groups.get(key) ?? []), verdict]);
  };
  for (const pair of pairs) {
    const verdict = judge(pair, answers.get(pair.id) ?? pair.heard);
    add("all", verdict);
    add(`lang:${pair.lang}`, verdict);
    for (const tag of pair.tags) {
      add(`tag:${tag}`, verdict);
      if (tag === "self-correction") add(`self-correction:${pair.lang}`, verdict);
    }
  }
  return new Map([...groups].map(([key, verdicts]) => [key, score(verdicts)]));
}
