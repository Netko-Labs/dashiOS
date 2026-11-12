/**
 * A page as compact text (read_page): headings and text in reading order,
 * and every element one can use on a line of its own with a number, e.g.
 *
 *     ## Ingresa a tu cuenta
 *     [7] textbox "Correo electrónico" value="alex@example.com"
 *     [9] password field "Contraseña" (filled: no)
 *     [12] button "Ingresar"
 *
 * A frame numbers its elements itself (`refOf`); the numbers it writes are
 * marked (`marker`), and the background renumbers every frame's into the
 * tab's (refs.ts). Secret fields say whether they are filled, never what with.
 */

import { collapse, isSkipped, nameOf, type PageNode, type Role, roleOf, secrecyOf } from "./node.ts";
import { marker, unmark } from "./refs.ts";

export interface ReadLimits {
  /** Characters of text, at most (the page is cut there and says so). */
  chars: number;
  /** Elements numbered, at most. */
  elements: number;
}

export const READ_LIMITS: ReadLimits = { chars: 60_000, elements: 2_000 };

export interface FrameText {
  text: string;
  /** Whether the limits cut it short. */
  truncated: boolean;
}

const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const MAX_VALUE = 200;
const MAX_OPTIONS = 20;

const quote = (text: string): string => JSON.stringify(text);

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A link's address as shown: a path when it is on the page's own origin. */
export function shownHref(href: string, origin: string | null): string {
  return origin && href.startsWith(`${origin}/`) ? href.slice(origin.length) : href;
}

/** The line for one element (after its number); `origin` is the page's, for shorter links. */
export function describeElement(node: PageNode, role: Role, origin: string | null = null): string {
  const name = nameOf(node, role);
  const parts = [name ? `${role} ${quote(name)}` : role];
  const flags: string[] = [];
  if (secrecyOf(node)) {
    // Whether it is filled, and by whom: never what with.
    flags.push(`filled: ${node.hasValue() || node.dashiFilled() ? "yes" : "no"}${node.dashiFilled() ? ", by Dashi" : ""}`);
  } else if (role === "link") {
    const href = node.href();
    if (href && !/^javascript:/i.test(href)) parts.push(`→ ${shownHref(href, origin)}`);
  } else if (role === "checkbox" || role === "radio" || role === "switch") {
    flags.push(node.checked() ? "checked" : "not checked");
  } else if (role === "combobox" || role === "listbox") {
    const options = node.options();
    const chosen = options.filter((option) => option.selected).map((option) => option.label);
    if (chosen.length > 0) parts.push(`value=${quote(clip(chosen.join(", "), MAX_VALUE))}`);
    if (options.length > 0) {
      const shown = options.slice(0, MAX_OPTIONS).map((option) => quote(clip(collapse(option.label).trim(), 60)));
      parts.push(`options: ${shown.join(", ")}${options.length > MAX_OPTIONS ? `, … (${options.length - MAX_OPTIONS} more)` : ""}`);
    }
  } else if (role === "textbox" || role === "searchbox" || role === "slider") {
    const value = node.value();
    if (value) parts.push(`value=${quote(clip(value, MAX_VALUE))}`);
    if (node.tag === "textarea") flags.push("multiline");
  }
  if (node.attr("required") !== null || node.attr("aria-required") === "true") flags.push("required");
  if (node.disabled()) flags.push("disabled");
  return `${parts.join(" ")}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`;
}

class Writer {
  readonly lines: string[] = [];
  private line = "";
  /** What the next line starts with: a heading's #s, a list item's dash. */
  private prefix = "";
  private chars = 0;
  private elements = 0;
  truncated = false;

  constructor(private readonly limits: ReadLimits) {}

  get full(): boolean {
    return this.truncated;
  }

  text(text: string): void {
    const clean = collapse(unmark(text));
    if (!clean.trim()) {
      if (this.line && !this.line.endsWith(" ")) this.line += " ";
      return;
    }
    this.line += this.line && !this.line.endsWith(" ") ? clean : clean.trimStart();
  }

  /** A cell of a table row, after the one before. */
  cell(): void {
    if (this.line.trim()) this.line = `${this.line.trimEnd()} | `;
  }

  flush(): void {
    const line = this.line.trim();
    this.line = "";
    if (!line) return;
    this.push(`${this.prefix}${line}`);
    this.prefix = "";
  }

  /** An element: on a line of its own, or (a link) in the line of text it is part of. */
  element(ref: number, description: string, inline = false): boolean {
    if (this.elements >= this.limits.elements) {
      this.truncated = true;
      return false;
    }
    this.elements++;
    if (inline) {
      this.line = `${this.line}${this.line && !this.line.endsWith(" ") ? " " : ""}[${marker(ref)}] ${description} `;
      return true;
    }
    this.flush();
    this.push(`${this.prefix}[${marker(ref)}] ${description}`);
    this.prefix = "";
    return true;
  }

  startBlock(prefix: string): void {
    this.flush();
    this.prefix = prefix;
  }

  endBlock(): void {
    this.flush();
    this.prefix = "";
  }

  private push(line: string): void {
    if (this.truncated) return;
    if (this.chars + line.length > this.limits.chars) {
      this.truncated = true;
      return;
    }
    this.chars += line.length + 1;
    this.lines.push(line);
  }
}

/**
 * A frame's text. `refOf` numbers an element, the same number for the same
 * element every time (content.ts keeps them), so a number read stays good
 * for a click.
 */
export function readFrame(
  root: PageNode,
  refOf: (node: PageNode) => number,
  limits: ReadLimits = READ_LIMITS,
  /** The page's origin: links to it are shown by their path. */
  origin: string | null = null,
): FrameText {
  const out = new Writer(limits);
  const walk = (node: PageNode, quiet: boolean): void => {
    if (out.full) return;
    if (node.tag === "#text") {
      if (!quiet) out.text(node.text());
      return;
    }
    if (isSkipped(node)) return;
    if (node.tag === "br") return out.flush();
    const role = roleOf(node);
    if (role && role !== "clickable") {
      // Links read in their sentence; every other control on a line of its own.
      out.element(refOf(node), describeElement(node, role, origin), role === "link");
      return;
    }
    if (node.tag === "img") {
      const alt = collapse(node.attr("alt") ?? "").trim();
      if (alt && !quiet) out.text(` (image: ${alt}) `);
      return;
    }
    const heading = HEADINGS[node.tag] ?? (node.attr("role") === "heading" ? Number(node.attr("aria-level")) || 2 : 0);
    const item = node.tag === "li";
    const block = heading > 0 || item || node.block() || node.tag === "tr";
    if (node.tag === "td" || node.tag === "th") out.cell();
    if (block) out.startBlock(heading > 0 ? `${"#".repeat(Math.min(heading, 6))} ` : item ? "- " : "");
    // A clickable container (onclick, tabindex) is numbered, and what is in it still read.
    if (role === "clickable") out.element(refOf(node), describeElement(node, role, origin));
    const hush = quiet || node.labelsField();
    for (const child of node.children()) walk(child, hush);
    if (block) out.endBlock();
    else if (node.tag === "td" || node.tag === "th") out.text(" ");
  };
  walk(root, false);
  out.flush();
  return { text: out.lines.join("\n"), truncated: out.truncated };
}
