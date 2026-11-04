/**
 * nmcli's terse output (`nmcli -t`): one record per line, fields separated by
 * `:`, with a literal `:` or `\` inside a field written `\:` or `\\`. SSIDs
 * and connection names are untrusted text, so anything that is not exactly
 * this format is rejected rather than guessed at.
 */

/** The fields of one terse line, or null if it is malformed. */
export function parseTerseLine(line: string, fields: number): string[] | null {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\") {
      const next = line[i + 1];
      if (next !== ":" && next !== "\\") return null;
      current += next;
      i++;
    } else if (char === ":") {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.length === fields ? parts : null;
}

/** Every well-formed line of `output` with exactly `fields` fields; the rest are skipped. */
export function parseTerse(output: string, fields: number): string[][] {
  return output
    .split("\n")
    .filter((line) => line !== "")
    .flatMap((line) => {
      const parsed = parseTerseLine(line, fields);
      return parsed ? [parsed] : [];
    });
}
