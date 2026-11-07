/** iCalendar's content lines (RFC 5545 3.1): folding, a line's name, parameters and value, text escapes, and durations. */

export interface ContentLine {
  /** Upper case. */
  name: string;
  /** Upper-cased parameter names, values without quotes. */
  params: Map<string, string>;
  value: string;
  /** The unfolded line as written. */
  raw: string;
}

/** The text with folded lines joined; CRLF, LF, and CR all end a line. */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out.filter((line) => line !== "");
}

/** One content line, or null when it has no name or no colon. */
export function parseLine(raw: string): ContentLine | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = raw.slice(0, colon);
  const parts: string[] = [];
  let start = 0;
  quoted = false;
  for (let i = 0; i <= head.length; i++) {
    const char = head[i];
    if (char === '"') quoted = !quoted;
    else if ((char === ";" && !quoted) || i === head.length) {
      parts.push(head.slice(start, i));
      start = i + 1;
    }
  }
  const name = (parts[0] ?? "").toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(name)) return null;
  const params = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const equals = part.indexOf("=");
    if (equals > 0) params.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1).replace(/^"|"$/g, ""));
  }
  return { name, params, value: raw.slice(colon + 1), raw };
}

export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_all, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** A parameter value as written: quoted when it holds `;`, `:` or `,`; quotes and control characters dropped. */
export function paramValue(value: string): string {
  const clean = value.replace(/["\u0000-\u001f\u007f]/g, "");
  return /[;:,]/.test(clean) ? `"${clean}"` : clean;
}

const encoder = new TextEncoder();

/** A content line as physical lines of at most 75 octets (a character is never split). */
export function fold(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > 75) {
      out.push(current);
      current = " ";
      size = 1;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out;
}

/** An RFC 5545 duration as minutes (negative for "-"), or null. Seconds are dropped. */
export function parseDuration(text: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text.trim());
  if (!match || text.trim().replace(/^[+-]?P/, "") === "" || /T$/.test(text.trim())) return null;
  const [, sign, weeks, days, hours, minutes] = match;
  const total = Number(weeks ?? 0) * 10_080 + Number(days ?? 0) * 1440 + Number(hours ?? 0) * 60 + Number(minutes ?? 0);
  return sign === "-" ? -total : total;
}

/** Minutes as a duration: 90 is "PT1H30M", 1440 is "P1D"; negative has a leading "-". */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const total = Math.abs(Math.round(minutes));
  if (total === 0) return "PT0S";
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const rest = total % 60;
  const time = `${hours > 0 ? `${hours}H` : ""}${rest > 0 ? `${rest}M` : ""}`;
  return `${sign}P${days > 0 ? `${days}D` : ""}${time ? `T${time}` : ""}`;
}
