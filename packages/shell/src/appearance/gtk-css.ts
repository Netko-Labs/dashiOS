/**
 * How GTK apps that draw their own title bar look (libadwaita and GTK 4
 * apps: Files, Text Editor, Calculator; GTK 3 headerbars; Chromium-based
 * browsers where they follow the GTK theme): Dashi's colors (shared/appearance/gtk-colors.ts)
 * and Dashi's window buttons. Dashi's title bars paint ume, broth, and kombu
 * controls in the Shapes style (comp/src/theme.rs: circle, bar, rounded
 * square); this ships the same look as the user's own GTK CSS, in a block
 * Dashi owns inside `~/.config/gtk-4.0/gtk.css` and
 * `~/.config/gtk-3.0/gtk.css`. Everything the person wrote outside the block
 * is left alone.
 *
 * The colors answer Dark Mode themselves in GTK 4 (the file has both modes);
 * GTK 3 gets the mode in force. The buttons follow Dark Mode through the
 * unfocused gray (comp's `control_inactive`). So the files are rewritten when
 * the mode or the corner radius changes and not otherwise, and nothing is
 * touched when the text is already what it should be. The markers keep their
 * first wording ("window buttons") so a block written by an earlier Dashi is
 * replaced, not joined by a second one.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_STYLE, type GtkStyle, gtk3Colors, gtk4Colors } from "../shared/appearance/gtk-colors.ts";

export const BEGIN = "/* >>> dashi window buttons (managed by Dashi; edit outside this block) */";
export const END = "/* <<< dashi window buttons */";

/** The traffic lights' colors, as comp/src/theme.rs paints them in both modes. */
const CLOSE = "#D0596F";
const MINIMIZE = "#E5B13F";
const ZOOM = "#4A9A7E";
/**
 * Unfocused windows. comp paints #CECBC6 / #525256 (`control_inactive`), but
 * libadwaita fades an unfocused headerbar to half opacity (not inside a
 * toolbar view, where it does not), so the same gray would all but vanish
 * there. These are a step stronger: they read as the compositor's gray where
 * the fade applies and as a slightly firmer one where it does not.
 */
const INACTIVE_LIGHT = "#B9B5AD";
const INACTIVE_DARK = "#66666C";

/**
 * The "Shapes" controls, as comp/src/theme.rs draws them on Dashi's own title
 * bars: a circle closes, a bar minimizes, a rounded square zooms. Width,
 * height, and corner radius in px.
 */
export const SHAPES = {
  close: { width: 12, height: 12, radius: 6 },
  minimize: { width: 14, height: 5, radius: 2.5 },
  maximize: { width: 11, height: 11, radius: 3 },
} as const;
/** comp's CONTROL_SPACING: centers 20 px apart. Each button is a 14 px slot plus padding. */
const SLOT = 14;
const REACH = 3;
/** comp's CONTROL_HOVER_SCALE. */
const HOVER_SCALE = 1.18;

const COLORS = { close: CLOSE, minimize: MINIMIZE, maximize: ZOOM } as const;
type Control = keyof typeof SHAPES;
const CONTROLS: readonly Control[] = ["close", "minimize", "maximize"];

/**
 * The block's rules for libadwaita and GTK 4. The button's image is the
 * shape: sized and rounded per control, its icon hidden (Dashi's controls
 * carry no glyph; the shape is the meaning).
 */
function gtk4Rules(inactive: string): string {
  const shape = (control: Control) => {
    const { width, height, radius } = SHAPES[control];
    return `windowcontrols > button.${control} > image {
  min-width: ${width}px;
  min-height: ${height}px;
  -gtk-icon-size: ${Math.min(width, height)}px;
  border-radius: ${radius}px;
  background-color: ${COLORS[control]};
}`;
  };
  return `windowcontrols { border-spacing: 0; }
windowcontrols.start { margin-left: 3px; }
windowcontrols.end { margin-right: 3px; }
windowcontrols > button {
  min-width: ${SLOT}px;
  min-height: ${SLOT}px;
  padding: ${REACH}px;
  margin: 0;
  background: none;
  box-shadow: none;
}
windowcontrols > button > image {
  padding: 0;
  margin: 0;
  color: transparent;
  box-shadow: none;
  transition: background-color 120ms ease-out, transform 120ms ease-out;
}
${CONTROLS.map(shape).join("\n")}
windowcontrols > button:hover > image { transform: scale(${HOVER_SCALE}); }
windowcontrols > button:active > image { filter: brightness(0.9); }
window:backdrop windowcontrols > button > image { background-color: ${inactive}; }
${CONTROLS.map((control) => `window:backdrop windowcontrols:hover > button.${control} > image { background-color: ${COLORS[control]}; }`).join("\n")}`;
}

/** The icon GTK 3 and Chromium size a title button around; the image's margin takes all of it out. */
const TITLE_ICON = 16;
/** comp's first control center and the gap between two controls' edges (centers 20 px apart). */
const CONTROL_FIRST_CENTER = 20;
const CONTROL_GAP = 7;
/** The headerbar's left padding in GTK 3 themes (Adwaita, adw-gtk3) and Chromium's frame. */
const HEADERBAR_PADDING = 6;
/** The spacing GTK 3's headerbar and Chromium put between title buttons. */
const BUTTON_SPACING = 6;
/** The clear border each button carries; hovered, it takes the color, so the shape grows a pixel each way. */
const HOVER_BORDER = 1;

/**
 * The same for GTK 3 apps and for Chromium-based browsers (Helium) on their
 * GTK theme, which draw their title buttons from GTK 3 style contexts under
 * a `headerbar` node too (Chromium's `ui/gtk/nav_button_provider_gtk.cc`).
 * GTK 3 can neither transform nor size a background (a `background-size`
 * on a gradient is ignored: it fills the button), so each button's box is
 * the shape itself: its 16 px icon gets a margin that takes it out of the
 * size, `min-width`/`min-height` give the shape's size, the radius rounds
 * it, and the glyph is transparent. A 1 px border, clear until hovered, is
 * the hover's growth. Spacing: the theme puts 6 px between buttons and the
 * headerbar has 6 px of padding; the margins below land the centers 20 px
 * apart from 20 px in, as comp spaces its own. GTK 3 marks every widget of
 * an unfocused window (and Chromium its buttons) `:backdrop`.
 */
function gtk3Rules(inactive: string): string {
  const lead = CONTROL_FIRST_CENTER - SHAPES.close.width / 2 - HEADERBAR_PADDING - HOVER_BORDER;
  // The visible gap is border + margin-right + spacing + border.
  const trailing = CONTROL_GAP - BUTTON_SPACING - 2 * HOVER_BORDER;
  const shape = (control: Control) => {
    const { width, height, radius } = SHAPES[control];
    const selector = `headerbar button.titlebutton.${control}`;
    const color = COLORS[control];
    // Each state names its image and color: themes style titlebuttons per state.
    return `${selector} { min-width: ${width}px; min-height: ${height}px; border-radius: ${radius + HOVER_BORDER}px; background-image: none; background-color: ${color}; }
${selector}:hover { background-image: none; background-color: ${color}; border-color: ${color}; }
${selector}:active { background-image: none; background-color: ${color}; border-color: ${color}; }
${selector}:backdrop { background-image: none; background-color: ${inactive}; border-color: transparent; }
${selector}:backdrop:hover { background-image: none; background-color: ${color}; border-color: ${color}; }`;
  };
  return `headerbar button.titlebutton {
  min-width: 0;
  min-height: 0;
  padding: 0;
  margin: 0 ${trailing}px 0 0;
  border: ${HOVER_BORDER}px solid transparent;
  background-clip: padding-box;
  background-image: none;
  color: transparent;
  box-shadow: none;
  text-shadow: none;
  -gtk-icon-shadow: none;
}
headerbar button.titlebutton image { margin: -${TITLE_ICON}px; opacity: 0; }
headerbar button.titlebutton.close { margin-left: ${lead}px; }
${CONTROLS.map(shape).join("\n")}`;
}

export type GtkVersion = 3 | 4;

/** Dashi's block for one GTK major version, markers included, without a trailing newline. */
export function dashiBlock(version: GtkVersion, style: GtkStyle = DEFAULT_STYLE): string {
  const inactive = style.dark ? INACTIVE_DARK : INACTIVE_LIGHT;
  const body = version === 4 ? `${gtk4Colors(style.radius)}\n${gtk4Rules(inactive)}` : `${gtk3Colors(style.dark)}\n${gtk3Rules(inactive)}`;
  return `${BEGIN}\n${body}\n${END}`;
}

/**
 * `existing` with Dashi's block set to `block`: replaced where it is, or added
 * after the person's own CSS. A begin marker with no end (a hand-edited file)
 * is treated as the block running to the end of the file, so the file never
 * gains a second copy.
 */
export function withBlock(existing: string, block: string): string {
  const [before, after] = split(existing);
  return join3(before, block, after);
}

/** `existing` without Dashi's block (for turning the feature off). */
export function withoutBlock(existing: string): string {
  if (!existing.includes(BEGIN)) return existing;
  const [before, after] = split(existing);
  return join3(before, after);
}

/**
 * The text before and after Dashi's block (both trimmed), or all of it as
 * "before" when there is no block. NUL bytes go: a file a crash left
 * zero-filled is not CSS, and GTK would refuse all of it, Dashi's block too.
 */
function split(raw: string): [string, string] {
  const text = raw.replaceAll("\0", "");
  const start = text.indexOf(BEGIN);
  if (start === -1) return [text.trim(), ""];
  const endAt = text.indexOf(END, start);
  return [text.slice(0, start).trim(), endAt === -1 ? "" : text.slice(endAt + END.length).trim()];
}

/** The non-empty parts as paragraphs of a file that ends in a newline; empty when there are none. */
function join3(...parts: string[]): string {
  const kept = parts.filter((part) => part !== "");
  return kept.length === 0 ? "" : `${kept.join("\n\n")}\n`;
}

export interface FileOps {
  read: (path: string) => string | null;
  /** Writes through a symlink (dotfile managers), atomically where it can. */
  write: (path: string, text: string) => void;
}

export const realFiles: FileOps = {
  read(path) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  write(path, text) {
    const target = existsSync(path) ? realpathSync(path) : path;
    mkdirSync(dirname(target), { recursive: true });
    const temp = `${target}.dashi-${process.pid}`;
    writeFileSync(temp, text);
    renameSync(temp, target);
  },
};

/** Where GTK looks for the user's CSS (`g_get_user_config_dir`). */
export function gtkCssPath(version: GtkVersion, env: Readonly<Record<string, string | undefined>>, home: string): string {
  const config = env.XDG_CONFIG_HOME?.startsWith("/") ? env.XDG_CONFIG_HOME : join(home, ".config");
  return join(config, `gtk-${version}.0`, "gtk.css");
}

/**
 * Writes the block into both files when it is not already there as it should
 * be for `style`. Returns the paths it changed. A file that cannot be written is
 * reported and skipped; GTK apps then keep their own buttons.
 */
export function syncGtkCss(style: GtkStyle, paths: Readonly<Record<GtkVersion, string>>, files: FileOps = realFiles): string[] {
  const changed: string[] = [];
  for (const version of [4, 3] as const) {
    const path = paths[version];
    const before = files.read(path) ?? "";
    const after = withBlock(before, dashiBlock(version, style));
    if (after === before) continue;
    try {
      files.write(path, after);
      changed.push(path);
    } catch (error) {
      console.error(`dashi-shell: could not write ${path}:`, error);
    }
  }
  return changed;
}
