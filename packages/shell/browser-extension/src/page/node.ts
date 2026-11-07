/**
 * A page's elements as the reader sees them (`PageNode`), and what each is:
 * its role, its name, and whether what it holds is a secret. Pure: the
 * content script adapts the DOM to `PageNode` (content.ts), and the tests
 * hand made-up trees, so the redaction is checked without a browser.
 *
 * A secret field's value is never read: the reader asks only `hasValue()`.
 */

export interface PageOption {
  label: string;
  value: string;
  selected: boolean;
}

export interface PageNode {
  /** "#text" for text; otherwise the element's tag, lower case. */
  readonly tag: string;
  /** A text node's characters. */
  text(): string;
  attr(name: string): string | null;
  children(): readonly PageNode[];
  /** Rendered: not display:none, visibility:hidden, `hidden` or aria-hidden. */
  shown(): boolean;
  /** Laid out as a block (it starts a line). */
  block(): boolean;
  /** A field's value now. Never called for a secret field (`secrecyOf`). */
  value(): string;
  /** Whether a field holds anything: all a secret field ever says. */
  hasValue(): boolean;
  checked(): boolean;
  options(): readonly PageOption[];
  /** The text of what labels it (aria-labelledby, `<label for>`, a label around it). */
  labelText(): string | null;
  /** A link's absolute address. */
  href(): string | null;
  disabled(): boolean;
  /** It was a password field before (a "show password" button makes it text), so it stays one. */
  wasPassword(): boolean;
  /** Dashi typed a secret into it (sign_in, fill_code, pay). */
  dashiFilled(): boolean;
  /** A label that names a field: its text is the field's name, not text of its own. */
  labelsField(): boolean;
}

export type Secrecy = "password" | "card" | "code";

export type Role =
  | "link"
  | "button"
  | "textbox"
  | "searchbox"
  | "password field"
  | "card field"
  | "one-time code field"
  | "checkbox"
  | "radio"
  | "switch"
  | "combobox"
  | "listbox"
  | "slider"
  | "file chooser"
  | "tab"
  | "menuitem"
  | "option"
  | "clickable";

/** ARIA roles an element may claim and keep. */
const ARIA: Record<string, Role> = {
  button: "button",
  link: "link",
  checkbox: "checkbox",
  radio: "radio",
  switch: "switch",
  tab: "tab",
  menuitem: "menuitem",
  menuitemcheckbox: "menuitem",
  menuitemradio: "menuitem",
  option: "option",
  combobox: "combobox",
  listbox: "listbox",
  textbox: "textbox",
  searchbox: "searchbox",
  slider: "slider",
  spinbutton: "textbox",
};

const BUTTON_INPUTS = new Set(["button", "submit", "reset", "image"]);

/** autocomplete tokens (whitespace-separated, any case). */
const tokens = (node: PageNode): string[] => (node.attr("autocomplete") ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/** Names and ids that say "card" or "code" when a page leaves out autocomplete. */
const CARD_NAME = /(^|[^a-z])(cc|card)[-_ ]?(num|number|no|nr)|cvc|cvv|csc|security[-_ ]?code|card[-_ ]?verification/i;
const CODE_NAME = /(^|[^a-z])(otp|totp|2fa|mfa)([^a-z]|$)|one[-_ ]?time[-_ ]?(code|pass)/i;

/** Whether a node takes typed text (and so may hold a secret). */
export function isField(node: PageNode): boolean {
  if (node.tag === "textarea") return true;
  if (node.tag === "input") return !["hidden", "checkbox", "radio", "range", "file", ...BUTTON_INPUTS].includes(inputType(node));
  const editable = node.attr("contenteditable");
  return editable === "" || editable === "true" || editable === "plaintext-only";
}

export const inputType = (node: PageNode): string => (node.attr("type") ?? "").toLowerCase().trim();

/**
 * Whether a field holds a secret, and which: a password field (or one that
 * was), autocomplete's passwords, cards (cc-*) and one-time codes, and names
 * that say so. A field Dashi typed a secret into stays secret.
 */
export function secrecyOf(node: PageNode): Secrecy | null {
  if (!isField(node)) return null;
  const auto = tokens(node);
  const names = [node.attr("name"), node.attr("id")].filter((value): value is string => value !== null).join(" ");
  if (inputType(node) === "password" || node.wasPassword() || auto.includes("current-password") || auto.includes("new-password")) return "password";
  if (auto.some((token) => token.startsWith("cc-")) || CARD_NAME.test(names)) return "card";
  if (auto.includes("one-time-code") || CODE_NAME.test(names)) return "code";
  return node.dashiFilled() ? "password" : null;
}

/** What a node is to someone using the page, or null for what is only text or layout. */
export function roleOf(node: PageNode): Role | null {
  if (node.tag === "#text") return null;
  const secrecy = secrecyOf(node);
  if (secrecy) return ({ password: "password field", card: "card field", code: "one-time code field" } as const)[secrecy];
  const claimed = ARIA[(node.attr("role") ?? "").toLowerCase().trim()];
  if (claimed) return claimed;
  switch (node.tag) {
    case "a":
      return node.attr("href") !== null ? "link" : null;
    case "button":
    case "summary":
      return "button";
    case "textarea":
      return "textbox";
    case "select":
      return node.attr("multiple") !== null ? "listbox" : "combobox";
    case "input": {
      const type = inputType(node);
      if (type === "hidden") return null;
      if (BUTTON_INPUTS.has(type)) return "button";
      if (type === "checkbox" || type === "radio") return type;
      if (type === "range") return "slider";
      if (type === "file") return "file chooser";
      if (type === "search") return "searchbox";
      return "textbox";
    }
  }
  if (isField(node)) return "textbox";
  const tabindex = Number(node.attr("tabindex"));
  if (node.attr("onclick") !== null || (Number.isInteger(tabindex) && tabindex >= 0 && node.attr("tabindex") !== null)) return "clickable";
  return null;
}

const SKIPPED = new Set(["script", "style", "noscript", "template", "head", "meta", "link", "iframe", "frame", "object", "embed", "option", "optgroup"]);

/** Whether the reader leaves a node and everything in it out. */
export const isSkipped = (node: PageNode): boolean => node.tag !== "#text" && (SKIPPED.has(node.tag) || !node.shown());

/** White space as a page shows it: runs as one space. */
export const collapse = (text: string): string => text.replace(/\s+/g, " ");

/** The text a node shows, images by their alt text; never a field's contents. */
export function textOf(node: PageNode): string {
  if (node.tag === "#text") return node.text();
  if (isSkipped(node) || isField(node) || node.tag === "select") return "";
  if (node.tag === "img") return node.attr("alt") ?? "";
  return node
    .children()
    .map(textOf)
    .join(node.block() ? " " : "");
}

const MAX_NAME = 100;

const short = (text: string, max: number): string => {
  const clean = collapse(text).trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/** What a node is called: its label, else its text (buttons, links), its placeholder or title. */
export function nameOf(node: PageNode, role: Role): string {
  const own = [node.attr("aria-label"), node.labelText()];
  const shown = role === "link" || role === "button" || role === "tab" || role === "menuitem" || role === "option" || role === "clickable";
  const input =
    node.tag === "input" ? [inputType(node) === "image" ? node.attr("alt") : null, BUTTON_INPUTS.has(inputType(node)) ? node.attr("value") : null] : [];
  const candidates = [...own, shown ? textOf(node) : null, ...input, node.attr("placeholder"), node.attr("title"), node.attr("alt")];
  for (const candidate of candidates) {
    const name = short(candidate ?? "", MAX_NAME);
    if (name) return name;
  }
  if (role === "button" && node.tag === "input") return { submit: "Submit", reset: "Reset" }[inputType(node)] ?? "";
  return short(node.attr("name") ?? "", MAX_NAME);
}
