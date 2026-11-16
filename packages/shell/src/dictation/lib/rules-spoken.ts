/**
 * Things said aloud that are written another way (compose.ts, with the
 * names and terms): an email address ("alex at example dot com"), a web
 * address ("example dot com slash docs"), a file's name ("index dot ts"),
 * and numbers from ten up ("twenty five" → 25, "dos mil" → 2000, "ten
 * percent" → 10%). Small numbers stay words, as people write them, and
 * so do "first" and "second", which may start a list.
 */

import { type Token, tokens } from "./tidy-tokens.ts";

const TLDS = new Set("com org net dev io es co ai app edu gov mx uk de fr me so sh".split(" "));
const EXTENSIONS = new Set(
  "ts tsx js jsx json md py rs go rb sh toml yaml yml css html txt lock cpp java kt swift sql env conf cfg ini xml svg png pdf".split(" "),
);
/** Never the name before a "dot": "the dot com bubble". */
const NOT_NAMES = new Set("the a an this that of in on to and or is was dot at".split(" "));

const low = (token: Token | undefined): string => (token?.word ? token.text.toLowerCase() : "");
const isName = (token: Token | undefined): boolean => token?.word === true && /^[\p{L}\p{N}_-]+$/u.test(token.text) && !NOT_NAMES.has(low(token));

/** How many tokens a "name dot name … dot end" takes from `at`, and its text; `ends` says which last words count. */
function dotted(list: readonly Token[], at: number, ends: ReadonlySet<string>): { length: number; text: string } | null {
  if (!isName(list[at])) return null;
  const parts = [low(list[at])];
  let next = at + 1;
  let best: { length: number; text: string } | null = null;
  while (low(list[next]) === "dot" && list[next + 1]?.word) {
    const part = low(list[next + 1]);
    parts.push(part);
    next += 2;
    if (ends.has(part)) best = { length: next - at, text: parts.join(".") };
  }
  return best;
}

/** "slash docs slash intro" after an address. */
function path(list: readonly Token[], at: number): { length: number; text: string } {
  let next = at;
  let text = "";
  while (low(list[next]) === "slash" && isName(list[next + 1])) {
    text += `/${low(list[next + 1])}`;
    next += 2;
  }
  return { length: next - at, text };
}

/** An address or a file name starting at `at`: how many tokens it takes and what is typed. */
function addressAt(list: readonly Token[], at: number): { length: number; text: string } | null {
  // "alex dot kim at example dot com"
  let local = at;
  const who = [low(list[at])];
  while (low(list[local + 1]) === "dot" && isName(list[local + 2])) {
    who.push(low(list[local + 2]));
    local += 2;
  }
  if (isName(list[at]) && low(list[local + 1]) === "at") {
    const domain = dotted(list, local + 2, TLDS);
    if (domain) return { length: local + 2 - at + domain.length, text: `${who.join(".")}@${domain.text}` };
  }
  const site = dotted(list, at, TLDS);
  if (site) {
    const rest = path(list, at + site.length);
    return { length: site.length + rest.length, text: site.text + rest.text };
  }
  const file = dotted(list, at, EXTENSIONS);
  // A file keeps its capitals: "README dot md".
  return file ? { length: file.length, text: `${list[at]?.text ?? ""}${file.text.slice(low(list[at]).length)}` } : null;
}

const UNITS: Readonly<Record<string, number>> = Object.fromEntries(
  (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen " +
    "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve"
  )
    .split(" ")
    .map((word, index) => [word, index % 20]),
);
const TENS: Readonly<Record<string, number>> = {
  ...Object.fromEntries("twenty thirty forty fifty sixty seventy eighty ninety".split(" ").map((word, index) => [word, (index + 2) * 10])),
  ...Object.fromEntries("veinte treinta cuarenta cincuenta sesenta setenta ochenta noventa".split(" ").map((word, index) => [word, (index + 2) * 10])),
  ...Object.fromEntries(
    "veintiuno veintidós veintitrés veinticuatro veinticinco veintiséis veintisiete veintiocho veintinueve".split(" ").map((word, index) => [word, 21 + index]),
  ),
};
const SCALES: Readonly<Record<string, number>> = Object.fromEntries([
  ["hundred", 100],
  ["cien", 100],
  ["ciento", 100],
  ["thousand", 1000],
  ["mil", 1000],
  ["million", 1_000_000],
  ["millón", 1_000_000],
  ["millones", 1_000_000],
]);
const HUNDREDS: Readonly<Record<string, number>> = Object.fromEntries(
  "doscientos trescientos cuatrocientos quinientos seiscientos setecientos ochocientos novecientos".split(" ").map((word, index) => [word, (index + 2) * 100]),
);

const isNumberWord = (word: string): boolean => word in UNITS || word in TENS || word in SCALES || word in HUNDREDS;

/** The number said from `at`: how many tokens, and its value; null when it is not one, or is a small one said alone. */
function numberAt(list: readonly Token[], at: number): { length: number; value: number } | null {
  let total = 0;
  let group = 0;
  let next = at;
  let words = 0;
  let last = "";
  for (; ; next++) {
    const word = low(list[next]);
    if ((word === "and" || word === "y") && words > 0 && isNumberWord(low(list[next + 1])) && (last in SCALES || last in TENS || last in HUNDREDS)) continue;
    if (!isNumberWord(word)) break;
    if (word in UNITS) {
      // "one two three" is three numbers, not one.
      if (last in UNITS) break;
      group += UNITS[word] ?? 0;
    } else if (word in TENS) {
      if (last in UNITS || last in TENS) {
        // "twenty twenty six", "nineteen ninety": a year, two pairs of digits.
        const pair = numberAt(list, next);
        if ((group === 19 || group === 20) && total === 0 && pair && pair.value < 100)
          return { length: next - at + pair.length, value: group * 100 + pair.value };
        break;
      }
      group += TENS[word] ?? 0;
    } else if (word in HUNDREDS) group += HUNDREDS[word] ?? 0;
    else {
      const scale = SCALES[word] ?? 1;
      if (scale === 100) group = (group === 0 ? 1 : group) * 100;
      else {
        total += (group === 0 ? 1 : group) * scale;
        group = 0;
      }
    }
    words++;
    last = word;
  }
  // The joining "and" or "y" last seen was not part of it.
  while (next > at && !isNumberWord(low(list[next - 1]))) next--;
  const value = total + group;
  if (words === 0 || (words === 1 && (value < 10 || last in SCALES))) return null;
  return { length: next - at, value };
}

/** A time said as two numbers ("nine thirty", "ten forty five"): how many tokens. It stays words: "nine 30" is nobody's way of writing it. */
function clockAt(list: readonly Token[], at: number): number {
  const hour = UNITS[low(list[at])];
  if (hour === undefined || hour < 1 || hour > 12 || isNumberWord(low(list[at - 1])) || !(low(list[at + 1]) in TENS)) return 0;
  const minute = UNITS[low(list[at + 2])];
  return minute !== undefined && minute < 10 ? 3 : 2;
}

const join = (list: readonly Token[]): string => list.map((token, index) => (token.gap && index > 0 ? " " : "") + token.text).join("");

/** The text with addresses, file names and numbers written as they are written; how many were changed. */
export function applySpoken(text: string): { text: string; fixes: number } {
  const list = tokens(text);
  const out: Token[] = [];
  let fixes = 0;
  for (let at = 0; at < list.length; at++) {
    const token = list[at];
    if (!token) continue;
    const address = token.word ? addressAt(list, at) : null;
    if (address) {
      out.push({ text: address.text, word: true, gap: token.gap });
      at += address.length - 1;
      fixes++;
      continue;
    }
    const clock = token.word ? clockAt(list, at) : 0;
    if (clock > 0) {
      out.push(...list.slice(at, at + clock));
      at += clock - 1;
      continue;
    }
    const number = token.word ? numberAt(list, at) : null;
    if (number) {
      const after = low(list[at + number.length]);
      const percent = after === "percent" || (after === "por" && low(list[at + number.length + 1]) === "ciento");
      out.push({ text: `${number.value}${percent ? "%" : ""}`, word: true, gap: token.gap });
      at += number.length - 1 + (percent ? (after === "por" ? 2 : 1) : 0);
      fixes++;
      continue;
    }
    out.push(token);
  }
  return { text: join(out), fixes };
}
