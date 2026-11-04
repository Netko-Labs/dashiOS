/**
 * Shortcuts as people write them in Dashi, and what keys they come to: "❖S"
 * is ❖ and S (the keyboard layer turns that into the app's own Ctrl+S, as it
 * does for the person), "⌥←" is Alt and the left arrow. Several chords in a
 * row are separated by spaces: "❖A ❖C". Modifiers are the glyphs ❖ ⌃ ⌥ ⇧ in
 * front of the key, or words joined by "+" ("super+s", "ctrl+shift+Tab").
 * Nothing here guesses: a name it doesn't know is an error the agent reads.
 */

export type Modifier = "super" | "ctrl" | "alt" | "shift";

/** One key with the modifiers held while it is pressed. */
export interface Chord {
  mods: Modifier[];
  /** An xkb keysym name: "s", "Left", "Return". */
  key: string;
}

/** The keysym that holds each modifier down. */
export const MODIFIER_KEYS: Record<Modifier, string> = {
  super: "Super_L",
  ctrl: "Control_L",
  alt: "Alt_L",
  shift: "Shift_L",
};

const GLYPHS: Record<string, Modifier> = { "❖": "super", "⌃": "ctrl", "⌥": "alt", "⇧": "shift" };
const WORDS: Record<string, Modifier> = {
  super: "super",
  cmd: "super",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
};

/** Keys named by a glyph. */
const KEY_GLYPHS: Record<string, string> = {
  "←": "Left",
  "→": "Right",
  "↑": "Up",
  "↓": "Down",
  "↩": "Return",
  "⏎": "Return",
  "⌫": "BackSpace",
  "⌦": "Delete",
  "⎋": "Escape",
  "⇥": "Tab",
  "␣": "space",
  "⇞": "Prior",
  "⇟": "Next",
  "↖": "Home",
  "↘": "End",
};

/** Keys named by a word, any case. */
const KEY_WORDS: Record<string, string> = {
  return: "Return",
  enter: "Return",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  space: "space",
  backspace: "BackSpace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  home: "Home",
  end: "End",
  pageup: "Prior",
  pagedown: "Next",
};

/** Punctuation by the keysym name xkb gives it. */
const PUNCTUATION: Record<string, string> = {
  ",": "comma",
  ".": "period",
  "/": "slash",
  "\\": "backslash",
  ";": "semicolon",
  "'": "apostrophe",
  "[": "bracketleft",
  "]": "bracketright",
  "-": "minus",
  "=": "equal",
  "`": "grave",
};

const MAX_CHORDS = 16;

function keyName(token: string): string | null {
  const glyph = KEY_GLYPHS[token];
  if (glyph) return glyph;
  const word = KEY_WORDS[token.toLowerCase()];
  if (word) return word;
  // F1 to F12.
  if (/^[fF](?:[1-9]|1[0-2])$/.test(token)) return `F${token.slice(1)}`;
  const chars = [...token];
  if (chars.length !== 1) return null;
  const char = chars[0] as string;
  // ❖S is ❖ and the S key; Shift is only ever asked for with ⇧.
  if (/^[A-Za-z0-9]$/.test(char)) return char.toLowerCase();
  return PUNCTUATION[char] ?? null;
}

function parseChord(text: string): Chord | string {
  const mods: Modifier[] = [];
  const add = (mod: Modifier): string | null => {
    if (mods.includes(mod)) return `${text} names ${mod} twice.`;
    mods.push(mod);
    return null;
  };
  let rest = text;
  if (text.length > 1 && text.includes("+") && !text.endsWith("+")) {
    const words = text.split("+");
    rest = words.pop() as string;
    for (const word of words) {
      const mod = WORDS[word.toLowerCase()] ?? GLYPHS[word];
      if (!mod) return `\`${word}\` in ${text} is not a modifier (❖ ⌃ ⌥ ⇧, or super, ctrl, alt, shift).`;
      const problem = add(mod);
      if (problem) return problem;
    }
  } else {
    const chars = [...text];
    while (chars.length > 1 && GLYPHS[chars[0] as string]) {
      const problem = add(GLYPHS[chars.shift() as string] as Modifier);
      if (problem) return problem;
    }
    rest = chars.join("");
  }
  const key = keyName(rest);
  if (key === null)
    return `\`${rest}\` in ${text} is not a key I know: a letter, digit, unshifted punctuation (, . / ; ' [ ] - =), arrow (←↑↓→), or a name like Return, Tab, Escape, F5. Type symbols such as * or + with type_text.`;
  return { mods, key };
}

/** "❖S", "⌥←", "⌃⇧Tab", "❖A ❖C" as chords, or what is wrong with it. */
export function parseKeys(text: string): Chord[] | string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '`keys` is empty; try "❖S" or "⌥←".';
  if (words.length > MAX_CHORDS) return `\`keys\` holds at most ${MAX_CHORDS} chords.`;
  const chords: Chord[] = [];
  for (const word of words) {
    const chord = parseChord(word);
    if (typeof chord === "string") return chord;
    chords.push(chord);
  }
  return chords;
}

export type KeyStep = { name: string; state?: "down" | "up" };

/** The key events for `chords`: modifiers down, the key, modifiers up, each chord in turn. */
export function keySteps(chords: ReadonlyArray<{ mods: readonly Modifier[]; key: string }>): KeyStep[] {
  return chords.flatMap(({ mods, key }) => [
    ...mods.map((mod): KeyStep => ({ name: MODIFIER_KEYS[mod], state: "down" })),
    { name: key },
    ...[...mods].reverse().map((mod): KeyStep => ({ name: MODIFIER_KEYS[mod], state: "up" })),
  ]);
}
