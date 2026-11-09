/**
 * A name under an icon, in at most two lines: broken where a reader breaks
 * a name (after a space, a hyphen or an underscore, before a dot), never
 * inside a word. "confidential.pdf" reads "confidential" over ".pdf", not
 * "confidential.p" over "df". A part too wide for a line, or a name too
 * long for two, loses its middle to an ellipsis instead, so its start and
 * its extension stay. Widths are estimated per letter in ems (the tile
 * can't measure every name before drawing it), on the generous side. Pure.
 */

/** Rough advance widths, in ems, of the UI font's letters. */
function letterWidth(char: string): number {
  if (" .,:;'|!ijlI".includes(char)) return 0.3;
  if ("ftr()[]-_".includes(char)) return 0.4;
  if ("mwMW@%".includes(char)) return 0.9;
  if (char >= "A" && char <= "Z") return 0.68;
  if (char >= "0" && char <= "9") return 0.6;
  // Letters of other scripts (CJK) are about square.
  return char.charCodeAt(0) > 0x2e7f ? 1 : 0.56;
}

/** The estimated width of `text`, in ems. */
export const textWidth = (text: string): number => [...text].reduce((sum, char) => sum + letterWidth(char), 0);

/** `text` with its middle taken out until it fits `room` ems, its start and end kept. */
export function fitMiddle(text: string, room: number): string {
  const chars = [...text];
  if (textWidth(text) <= room) return text;
  let head = Math.ceil(chars.length / 2);
  let tail = chars.length - head;
  const shown = (): string => `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
  // Drop from the longer side, the end's last (it holds the extension).
  while (head + tail > 0 && textWidth(shown()) > room) {
    if (head >= tail) head--;
    else tail--;
  }
  return shown();
}

/** The places a name may break: each part ends after a space, hyphen or underscore, or before a dot (not a leading one). */
export function nameParts(name: string): string[] {
  return name.split(/(?<=[\s\-_])|(?<=.)(?=\.)/u).filter((part) => part !== "");
}

/**
 * `parts` with the extension kept on its last word ("meeting-" over "notes.txt", never "meeting-notes"
 * over ".txt"), when the name has another place to break; "confidential.pdf" still breaks before its dot.
 */
export function keepExtension(parts: readonly string[]): string[] {
  const last = parts.at(-1);
  if (parts.length < 3 || last === undefined || !last.startsWith(".")) return [...parts];
  if (!parts.slice(0, -2).some((part) => /[\s\-_]$/u.test(part))) return [...parts];
  return [...parts.slice(0, -2), `${parts.at(-2)}${last}`];
}

/** `name` as lines that each fit `room` ems, at most `lines` of them, joined by line breaks. */
export function tileName(name: string, room: number, lines = 2): string {
  const parts = keepExtension(nameParts(name));
  const out: string[] = [];
  let line = "";
  let at = 0;
  for (; at < parts.length; at++) {
    const part = parts[at] as string;
    // A space at a line's end takes no room.
    if (textWidth((line + part).trimEnd()) <= room) {
      line += part;
      continue;
    }
    // A part wider than a whole line can't break at a boundary: the name loses its middle instead.
    if (line === "") return fitMiddle(name, room);
    out.push(line.trimEnd());
    line = "";
    if (out.length === lines - 1) break;
    at--;
  }
  if (at >= parts.length) return [...out, line].join("\n");
  // The last line takes what is left, its middle cut when it is too long.
  const rest = parts.slice(at).join("");
  return [...out, fitMiddle(rest, room)].join("\n");
}
