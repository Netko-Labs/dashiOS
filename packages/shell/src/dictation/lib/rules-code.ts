/**
 * The Developer profile's exact rules (compose.ts; research 1.11, "spoken
 * formatters"): casing by voice, symbols by voice, and backticks around
 * identifiers. No model, never a guess: each needs its own words said.
 *
 * - "camel case user id" → userId; also pascal, snake, kebab, constant and
 *   dot case. The words up to the next mark or joining word ("to", "is",
 *   "and"…) are the identifier, six at most.
 * - "dash dash help" → --help; "dash v" → -v; "dry dash run" stays words.
 * - Symbols with unmistakable names: "underscore", "open paren", "equals
 *   sign", "double equals", "fat arrow", "backtick", "tilde", "at sign",
 *   "ampersand", "semicolon", "forward slash", "backslash"; "pipe" in a
 *   terminal only.
 * - In chat and commit messages an identifier gets backticks: `userId`,
 *   `--dry-run`, `src/main.ts`, `index.ts`. Never in a terminal.
 */

const STOPS = new Set("to is equals and then in of for with as from on at or but so that which it the a an".split(" "));
const MOST_WORDS = 6;

type Casing = "camel" | "pascal" | "snake" | "kebab" | "constant" | "dot";

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

function cased(kind: Casing, words: readonly string[]): string {
  const lower = words.map((word) => word.toLowerCase());
  switch (kind) {
    case "camel":
      return lower.map((word, index) => (index === 0 ? word : cap(word))).join("");
    case "pascal":
      return lower.map(cap).join("");
    case "snake":
      return lower.join("_");
    case "kebab":
      return lower.join("-");
    case "constant":
      return lower.join("_").toUpperCase();
    case "dot":
      return lower.join(".");
  }
}

const FORMATTER = /\b(camel|pascal|snake|kebab|constant|dot) case((?: [\p{L}\p{N}]+)+)/giu;

function formatters(text: string, count: { fixes: number }): string {
  return text.replace(FORMATTER, (whole, kind: string, rest: string) => {
    const said = rest.trim().split(" ");
    const taken: string[] = [];
    for (const word of said) {
      if (taken.length >= MOST_WORDS || STOPS.has(word.toLowerCase())) break;
      taken.push(word);
    }
    if (taken.length === 0) return whole;
    count.fixes++;
    const left = said.slice(taken.length).join(" ");
    return cased(kind.toLowerCase() as Casing, taken) + (left ? ` ${left}` : "");
  });
}

/** A symbol said by name: what is typed, and whether a space stays before and after it. */
interface Symbol {
  said: RegExp;
  mark: string;
  before: boolean;
  after: boolean;
  terminal?: true;
}

const symbol = (said: string, mark: string, before: boolean, after: boolean, terminal?: true): Symbol => ({
  said: new RegExp(`\\s*\\b${said}\\b\\s*`, "giu"),
  mark,
  before,
  after,
  ...(terminal ? { terminal } : {}),
});

const SYMBOLS: readonly Symbol[] = [
  symbol("triple equals", "===", true, true),
  symbol("double equals", "==", true, true),
  symbol("equals sign", "=", true, true),
  symbol("fat arrow", "=>", true, true),
  symbol("open paren(?:thesis)?", "(", true, false),
  symbol("close paren(?:thesis)?", ")", false, true),
  symbol("open bracket", "[", true, false),
  symbol("close bracket", "]", false, true),
  symbol("open brace", "{", true, true),
  symbol("close brace", "}", true, true),
  symbol("underscore", "_", false, false),
  symbol("forward slash", "/", false, false),
  symbol("backslash", "\\", false, false),
  symbol("at sign", "@", true, false),
  symbol("dollar sign", "$", true, false),
  symbol("ampersand", "&", true, true),
  symbol("semicolon", ";", false, true),
  symbol("backtick", "`", true, true),
  symbol("tilde", "~", true, false),
  symbol("pipe", "|", true, true, true),
];

function symbols(text: string, terminal: boolean, count: { fixes: number }): string {
  let out = text;
  for (const each of SYMBOLS) {
    if (each.terminal && !terminal) continue;
    out = out.replace(each.said, (whole, offset: number) => {
      count.fixes++;
      const lead = each.before && offset > 0 && /^\s/.test(whole) ? " " : "";
      const trail = each.after && /\s$/.test(whole) ? " " : "";
      return `${lead}${each.mark}${trail}`;
    });
  }
  return out;
}

/** "dash dash help" → --help, "dash v" → -v. */
function flags(text: string, count: { fixes: number }): string {
  return text
    .replace(/\bdash dash ([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)/giu, (_whole, name: string) => {
      count.fixes++;
      return `--${name.toLowerCase()}`;
    })
    .replace(/(?<!\b(?:a|the|one|this|that) )\bdash ([\p{L}\p{N}]{1,2})\b(?![-'’])/giu, (whole, name: string) => {
      // "a dash of salt" is not a flag.
      if (STOPS.has(name.toLowerCase())) return whole;
      count.fixes++;
      return `-${name.toLowerCase()}`;
    });
}

const EXTENSIONS = "ts|tsx|js|jsx|json|md|py|rs|go|rb|sh|toml|yaml|yml|css|html|txt|lock|c|h|cpp|java|kt|swift|sql|env|conf|cfg|ini|xml|svg|png";
/** Something a reader should see as code: a flag, a path, a file name, a call, snake_case, camelCase. */
const IDENTIFIER = new RegExp(
  [
    "--[\\p{L}\\p{N}][\\p{L}\\p{N}-]*",
    "[\\p{L}\\p{N}_.~-]+(?:/[\\p{L}\\p{N}_.-]+)+",
    `[\\p{L}\\p{N}_-]+\\.(?:${EXTENSIONS})\\b`,
    "[\\p{L}_][\\p{L}\\p{N}_]*\\(\\)",
    "[\\p{L}\\p{N}]+(?:_[\\p{L}\\p{N}]+)+",
    "\\p{Ll}+(?:\\p{Lu}[\\p{Ll}\\p{N}]+)+",
  ].join("|"),
  "gu",
);

/** Backticks around what reads as code, unless it already has them or is a name the person writes that way. */
export function backticks(text: string, names: ReadonlySet<string>): { text: string; fixes: number } {
  let fixes = 0;
  const out = text.replace(IDENTIFIER, (found, offset: number) => {
    const before = text[offset - 1] ?? " ";
    const after = text[offset + found.length] ?? " ";
    if (before === "`" || after === "`" || /[\p{L}\p{N}_@/]/u.test(before) || names.has(found.toLowerCase())) return found;
    // An address is not code.
    if (/^(?:https?:|www\.)/i.test(found) || /^[\w.-]+\.(?:com|org|net|dev|io)(?:\/|$)/i.test(found)) return found;
    fixes++;
    return `\`${found}\``;
  });
  return { text: out, fixes };
}

/** The Developer profile's formatters and symbols; `terminal` is a shell's or an agent's prompt. */
export function applyCode(text: string, terminal: boolean): { text: string; fixes: number } {
  const count = { fixes: 0 };
  const out = symbols(flags(formatters(text, count), count), terminal, count);
  return { text: out, fixes: count.fixes };
}
