/**
 * The name rule (docs/decisions.md D55): letters of any script, digits, spaces, `-`, `'` and `.`;
 * 1 to 24 characters, the store's own limit (shared/pill/persona.ts); no line break. Never another
 * assistant's name: Dashi does not pass for one. The name is the assistant's; the system, its key
 * and Settings keep the word Dashi.
 */

export const NAME_MAX = 24;
export const YOU_MAX = 30;
export const NOTE_MAX = 200;

/** Whole names, any case, that are another assistant's. */
const TAKEN = new Set(["claude", "chatgpt", "gpt", "codex", "gemini", "copilot", "siri", "alexa", "cortana", "grok", "bixby"]);

export const TAKEN_NAME = "That is another assistant's name.";

export type NameCheck = { ok: true; name: string } | { ok: false; why: string };

/** A typed name as it would be kept; an empty field is Dashi again. */
export function checkName(typed: string): NameCheck {
  if (/[\n\r\0]/.test(typed)) return { ok: false, why: "A name is one line." };
  const name = typed.trim().replace(/\s+/g, " ");
  if (name === "") return { ok: true, name: "Dashi" };
  if ([...name].length > NAME_MAX || name.length > NAME_MAX) return { ok: false, why: `A name is ${NAME_MAX} characters at most.` };
  if (!/^[\p{L}\p{M}\p{N} '.-]+$/u.test(name)) return { ok: false, why: "Use letters, digits, spaces, - ' and . only." };
  if (TAKEN.has(name.toLowerCase())) return { ok: false, why: TAKEN_NAME };
  return { ok: true, name };
}

/** Text the person typed, made safe to stand inside a line of the prompt: one line, no quotes or brackets, cut to `max`. */
export function plainText(text: string, max: number): string {
  const clean = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/["{}<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...clean].slice(0, max).join("").trim();
}
