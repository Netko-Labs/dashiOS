/**
 * What apps send is untrusted text: it is cut to sane lengths and cleaned of
 * control characters before it reaches the store, and the spec's markup
 * subset in a body is reduced to plain text (the banner doesn't style it).
 */

export const LIMITS = {
  appName: 64,
  summary: 200,
  body: 1000,
  actions: 6,
  actionKey: 64,
  actionLabel: 40,
  hint: 512,
} as const;

/** `text` without control characters (tabs and newlines become spaces), cut to `max` with an ellipsis. */
export function clean(text: string, max: number): string {
  const plain = text.replace(/[\t\n\r]+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "");
  return plain.length <= max ? plain : `${plain.slice(0, max - 1).trimEnd()}…`;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * A body with the notification spec's markup (`<b> <i> <u> <a href> <img>`
 * and `<br>`) taken out and its five entities decoded. Only those tags go: a
 * plain-text body that says "a < b" is left alone.
 */
export function plainBody(body: string): string {
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:b|i|u)>/gi, "")
    .replace(/<a(?:\s[^<>]*)?>|<\/a>/gi, "")
    .replace(/<img(?:\s[^<>]*)?\/?>/gi, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? "");
}

/**
 * `text` cut at a word boundary to at most `max` characters, with an ellipsis,
 * for places that show a fixed number of lines and can't measure wrapping.
 */
export function ellipsize(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
