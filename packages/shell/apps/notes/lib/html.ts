/**
 * Rich text pasted from a browser, as Markdown where it is simple: headings,
 * paragraphs, bold, italic, struck, code, links, lists (nested, numbered),
 * quotes, rules, code blocks and tables. Anything else gives its words. Not
 * a browser: tags are read in order, never as a tree, which is enough for
 * what a selection on a page holds. Pure.
 */

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** `&amp;`, `&#39;`, `&#x2014;` as letters. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const INLINE: Readonly<Record<string, string>> = { strong: "**", b: "**", em: "*", i: "*", s: "~~", del: "~~", strike: "~~", code: "`" };
const BLOCKS = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "ul",
  "ol",
  "table",
]);

interface State {
  out: string;
  lists: Array<{ ordered: boolean; count: number }>;
  quote: number;
  pre: boolean;
  links: string[];
  row: string[] | null;
  cell: string | null;
  rows: number;
}

/** Ends the line being written: the next words start a new one (a block's or a paragraph's blank line). */
function breakLine(state: State, blank: boolean): void {
  state.out = state.out.replace(/[ \t]+$/, "");
  if (state.out === "") return;
  const want = blank && state.lists.length === 0 ? "\n\n" : "\n";
  if (!state.out.endsWith(want)) state.out = state.out.replace(/\n*$/, want);
}

/** Writes words where they go: a table's cell, else the text, after a quote's or a list item's marker on a new line. */
function write(state: State, text: string, words = false): void {
  if (state.cell !== null) {
    state.cell += text.replace(/\|/g, "\\|");
    return;
  }
  if (text === "") return;
  if (state.out === "" || state.out.endsWith("\n")) {
    if (!state.pre && text.trim() === "") return;
    state.out += "> ".repeat(state.quote);
    if (words && !state.pre) text = text.trimStart();
  }
  state.out += text;
}

function openTag(state: State, name: string, attributes: string): void {
  if (BLOCKS.has(name)) breakLine(state, true);
  const heading = /^h([1-6])$/.exec(name);
  if (heading) return write(state, `${"#".repeat(Number(heading[1]))} `);
  if (INLINE[name] && !state.pre) return write(state, INLINE[name] ?? "");
  if (name === "a") {
    const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attributes);
    state.links.push(decodeEntities(href?.[2] ?? href?.[3] ?? ""));
    return write(state, "[");
  }
  if (name === "ul" || name === "ol") return void state.lists.push({ ordered: name === "ol", count: 0 });
  if (name === "li") {
    breakLine(state, false);
    const list = state.lists.at(-1) ?? { ordered: false, count: 0 };
    list.count++;
    const indent = "  ".repeat(Math.max(0, state.lists.length - 1));
    return write(state, `${indent}${list.ordered ? `${list.count}.` : "-"} `);
  }
  if (name === "blockquote") state.quote++;
  if (name === "pre") {
    state.pre = true;
    write(state, "```\n");
  }
  if (name === "br") breakLine(state, false);
  if (name === "hr") {
    write(state, "---");
    breakLine(state, true);
  }
  if (name === "tr") state.row = [];
  if ((name === "td" || name === "th") && state.row) state.cell = "";
}

function closeTag(state: State, name: string): void {
  if (INLINE[name] && !state.pre) return write(state, INLINE[name] ?? "");
  if (name === "a") return write(state, `](${state.links.pop() ?? ""})`);
  if (name === "ul" || name === "ol") state.lists.pop();
  if (name === "blockquote") state.quote = Math.max(0, state.quote - 1);
  if (name === "pre") {
    breakLine(state, false);
    write(state, "```");
    state.pre = false;
  }
  if ((name === "td" || name === "th") && state.row && state.cell !== null) {
    state.row.push(state.cell.trim().replace(/\s+/g, " "));
    state.cell = null;
  }
  if (name === "tr" && state.row) {
    const row = state.row;
    state.row = null;
    breakLine(state, false);
    write(state, `| ${row.join(" | ")} |`);
    if (state.rows++ === 0) write(state, `\n| ${row.map(() => "---").join(" | ")} |`);
  }
  if (name === "table") state.rows = 0;
  if (BLOCKS.has(name) || name === "li") breakLine(state, BLOCKS.has(name));
}

/** The Markdown for `html`. */
export function htmlToMarkdown(html: string): string {
  const state: State = { out: "", lists: [], quote: 0, pre: false, links: [], row: null, cell: null, rows: 0 };
  const source = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "");
  for (const token of source.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)/gi)) {
    const [, closing, tag, attributes, text] = token;
    if (text !== undefined) {
      const words = decodeEntities(text);
      write(state, state.pre ? words : words.replace(/\s+/g, " "), true);
    } else if (closing) closeTag(state, (tag ?? "").toLowerCase());
    else openTag(state, (tag ?? "").toLowerCase(), attributes ?? "");
  }
  return state.out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
