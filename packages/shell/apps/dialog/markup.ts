/**
 * The text a dialog shows. Zenity hands `--text` to GTK as Pango markup
 * after expanding C escapes (g_strcompress), so a script's "\n" breaks the
 * line and "<b>Done</b>" is bold. Metal draws one style per text, so the
 * tags are taken out and the entities read; `--no-markup` shows the text as
 * given, escapes and all, as Zenity does.
 */

const ESCAPES: Readonly<Record<string, string>> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };

/** g_strcompress: C escapes (\n, \t, \\, \", octal \NNN) to the characters they stand for; any other `\x` is `x`. */
export function compressEscapes(text: string): string {
  return text.replace(/\\([0-7]{1,3}|[\s\S])?/g, (_, code: string | undefined) => {
    if (code === undefined) return "";
    if (/^[0-7]/.test(code)) return String.fromCharCode(Number.parseInt(code, 8) & 0xff);
    return ESCAPES[code] ?? code;
  });
}

const NAMED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** XML's entities (`&amp;`, `&#38;`, `&#x26;`) read; an unknown one is left as it is. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

/** Pango markup as plain text: tags out (`<b>`, `</span>`, `<br/>`), entities read. A `<` that opens no tag stays. */
export function stripMarkup(text: string): string {
  return decodeEntities(text.replace(/<\/?[a-z][^<>]*>/gi, ""));
}

/** What a dialog shows for `--text`: escapes expanded and markup taken out, or the text as given with `--no-markup`. */
export function displayText(text: string, noMarkup: boolean): string {
  return noMarkup ? text : stripMarkup(compressEscapes(text));
}

export interface Message {
  /** The bold line an alert leads with; empty when the message is all body. */
  headline: string;
  /** What follows, in the regular weight. */
  body: string;
}

const HEADLINE_MAX = 90;

/**
 * An alert's text the way the Mac sets one: a short first paragraph in bold,
 * the rest under it. A message that is one long paragraph stays regular.
 */
export function splitMessage(text: string): Message {
  const trimmed = text.trim();
  const at = trimmed.indexOf("\n");
  const first = at < 0 ? trimmed : trimmed.slice(0, at).trim();
  const rest = at < 0 ? "" : trimmed.slice(at + 1).replace(/^\s*\n/, "");
  if (first.length === 0 || first.length > HEADLINE_MAX) return { headline: "", body: trimmed };
  return { headline: first, body: rest };
}
