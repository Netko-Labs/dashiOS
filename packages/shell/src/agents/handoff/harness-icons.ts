/**
 * Each harness's own mark (docs/actions.md, "Agents from the launcher"): on
 * its "Hand it off" row, the grants card's field, a run's row and card, and
 * the menu bar's agent mark. Dashi's own drawings on the sidebar glyphs' 16-unit
 * grid, one color, tinted by the Svg `color` like every glyph (shiso, CO-3):
 * a starburst for Claude Code, a knot of three links for Codex, a block in
 * brackets for OpenCode. Never the companies' artwork (design.html, "Never
 * ship another company's assets"). A harness Dashi doesn't know gets the
 * agents' sparkle. The notification's icon is the same mark on a shiso tile
 * in shell/icons/ (`harnessIconName`). Pure.
 */

import { SPARKLE } from "../../settings-app/glyphs.ts";

const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;

/** Claude Code: a starburst, ten rays long and short in turn around a dot. */
export const CLAUDE_CODE_GLYPH = svg(
  '<path d="M8.07 6.7L8.33 1.71M8.73 6.92L10.74 3.94M9.24 7.6L13.71 6.15M9.21 8.47L12.76 9.83M8.8 9.02L11.94 13.04M8 9.3L8 12.8M7.18 9.01L4.16 12.74M6.78 8.44L3.3 9.71M6.76 7.6L2.1 6.08M7.29 6.91L5.33 3.89" stroke="#000" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="8" cy="8" r="1.6" fill="#000"/>',
);

/** Codex: a knot, three rounded links crossing at 60°. */
export const CODEX_GLYPH = svg(
  '<path d="M4.2 10.3L11.8 10.3A2.3 2.3 0 0 0 11.8 5.7L4.2 5.7A2.3 2.3 0 0 0 4.2 10.3zM4.11 5.86L7.91 12.44A2.3 2.3 0 0 0 11.89 10.14L8.09 3.56A2.3 2.3 0 0 0 4.11 5.86zM7.91 3.56L4.11 10.14A2.3 2.3 0 0 0 8.09 12.44L11.89 5.86A2.3 2.3 0 0 0 7.91 3.56z" stroke="#000" stroke-width="1.2" fill="none" stroke-linejoin="round"/>',
);

/** OpenCode: a block between square brackets. */
export const OPENCODE_GLYPH = svg(
  '<path d="M5 2.6H3.2v10.8H5M11 2.6h1.8v10.8H11" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="6.2" y="7.4" width="3.6" height="3.6" rx=".6" fill="#000"/>',
);

const GLYPHS: Readonly<Record<string, string>> = {
  "claude-code": CLAUDE_CODE_GLYPH,
  codex: CODEX_GLYPH,
  opencode: OPENCODE_GLYPH,
};

/** A harness's glyph by its id; the agents' sparkle for one Dashi doesn't know. */
export function harnessGlyph(harness: string | null | undefined): string {
  return (harness && Object.hasOwn(GLYPHS, harness) ? GLYPHS[harness] : undefined) ?? SPARKLE;
}

/** Its icon in shell/icons/ (a shiso tile, for notifications): "claude-code", or "agents" for one Dashi doesn't know. */
export function harnessIconName(harness: string | null | undefined): string {
  return harness && Object.hasOwn(GLYPHS, harness) ? harness : "agents";
}
