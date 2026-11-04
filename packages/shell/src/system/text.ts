/** Text from outside the shell (a network name, a device name) made safe to put in a row. */

// Control characters would break a row; bidirectional overrides let a name
// draw as another name.
const UNSAFE_IN_NAMES = /[\p{Cc}\u{2028}\u{2029}\u{61c}\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;

/** `text` without control characters or bidirectional overrides, trimmed. */
export function cleanText(text: string): string {
  return text.replace(UNSAFE_IN_NAMES, "").trim();
}
