/**
 * The text Dashi reads from and writes to a harness: the JSON objects a
 * harness prints (one object, or one per line, some after a banner), and the
 * TOML strings in the config it is started with.
 */

type Raw = Record<string, unknown>;
export const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
export const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export function jsonLines(stdout: string): Raw[] {
  return stdout.split("\n").flatMap((line) => {
    const text = line.trim();
    if (!text.startsWith("{")) return [];
    try {
      const value: unknown = JSON.parse(text);
      return isRaw(value) ? [value] : [];
    } catch {
      return [];
    }
  });
}

/** The last JSON object a program printed (some print a banner first). */
export function lastJson(stdout: string): Raw | null {
  const whole = stdout.trim();
  try {
    const value: unknown = JSON.parse(whole);
    if (isRaw(value)) return value;
  } catch {
    // Not one object: look line by line.
  }
  return jsonLines(stdout).at(-1) ?? null;
}

/** A TOML basic string (JSON's escapes are TOML's for these characters). */
export const toml = (value: string): string => JSON.stringify(value);
