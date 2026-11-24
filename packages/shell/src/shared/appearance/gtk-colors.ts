/**
 * Dashi's colors as GTK knows them. libadwaita (and adw-gtk3, which copies its
 * names) paints every surface from a handful of named colors: window, view,
 * headerbar, sidebar, card, popover, dialog, and the accent, destructive,
 * warning, success, and error pairs. Setting those in the person's gtk.css
 * re-colors every GNOME app at once, so Files or Text Editor beside a
 * Dashi-decorated window read as one desktop: the headerbar is the very color
 * comp's render/titlebar.rs paints a title bar (#EEEBE4 / #141417 active,
 * #F6F4EF / #0B0B0D inactive), the accent is the person's (theme.ts
 * `selection`, as the guard draws it in each mode, with its `onAccent` words;
 * Kombu by default), and destructive is ume.
 *
 * Two spellings, because versions differ: `@define-color window_bg_color`
 * (every libadwaita, and GTK 3) and the custom property `--window-bg-color`
 * (libadwaita 1.6+, which maps one to the other at `:root`, so either works
 * there; both are written so a version that reads only one still follows).
 */

import { drawAccent, GNOME_ACCENTS, GTK_DARK, GTK_LIGHT, type GtkNamedColors, isKombu, lightColors, onOf } from "@dashi/ui";
import { CORNER_RADIUS, DEFAULT_CORNERS } from "./corners.ts";

/** What the block depends on: Dark Mode, the Appearance setting's window corners, and the accent. */
export interface GtkStyle {
  dark: boolean;
  /** Logical pixels; the compositor rounds every window to the same radius (IPC `chrome {radius}`). */
  radius: number;
  /** The accent's seed (appearance/accent.ts); null is Kombu. */
  accent: string | null;
}

export const DEFAULT_STYLE: GtkStyle = { dark: false, radius: CORNER_RADIUS[DEFAULT_CORNERS], accent: null };

type NamedColors = GtkNamedColors;

/** Kombu, Dashi's own accent: the colour of a selected row in every Dashi list until the person picks another. */
export const ACCENT = lightColors.selection;

/** The accent's fill as Light draws it, the one colour toolkits that take a single accent get; Kombu with no seed. */
export const accentFill = (seed: string | null): string => (seed === null || isKombu(seed) ? ACCENT : drawAccent(seed, false).fill);

/** The accent pair in a mode: Kombu's as it always was, else the guard's fill and the words on it. */
function accentPair(seed: string | null, dark: boolean): Pick<NamedColors, "accent_bg_color" | "accent_fg_color"> {
  if (seed === null || isKombu(seed)) return { accent_bg_color: ACCENT, accent_fg_color: onOf(lightColors).onInk };
  const drawn = drawAccent(seed, dark);
  return { accent_bg_color: drawn.fill, accent_fg_color: drawn.on };
}

export function gtkColors(dark: boolean, accent: string | null = null): NamedColors {
  return { ...(dark ? GTK_DARK : GTK_LIGHT), ...accentPair(accent, dark) };
}

/**
 * The names GTK 3's own Adwaita (and Chromium, which paints from the GTK theme)
 * still read when adw-gtk3 is not installed. adw-gtk3 defines the same names
 * from the libadwaita ones, so saying it again changes nothing there.
 */
function legacyColors(colors: NamedColors): Readonly<Record<string, string>> {
  return {
    theme_bg_color: colors.window_bg_color,
    theme_fg_color: colors.window_fg_color,
    theme_base_color: colors.view_bg_color,
    theme_text_color: colors.view_fg_color,
    theme_selected_bg_color: colors.accent_bg_color,
    theme_selected_fg_color: colors.accent_fg_color,
    theme_unfocused_selected_bg_color: colors.accent_bg_color,
    theme_unfocused_selected_fg_color: colors.accent_fg_color,
  };
}

const defineColors = (colors: NamedColors, indent = ""): string =>
  Object.entries({ ...colors, ...legacyColors(colors) })
    .map(([name, value]) => `${indent}@define-color ${name} ${value};`)
    .join("\n");

const customProperties = (colors: NamedColors, indent: string): string =>
  Object.entries(colors)
    .map(([name, value]) => `${indent}--${name.replaceAll("_", "-")}: ${value};`)
    .join("\n");

/**
 * libadwaita draws most apps' top bar "flat": no color of its own, so the
 * window's background shows through and a headerbar reads as part of the
 * page. Next to Dashi's tinted title bars that looks like a different desktop,
 * so a flat top bar takes the headerbar color too (raised ones already do).
 * The backdrop rule keeps the unfocused tint comp paints.
 */
const FLAT_TOP_BARS = `toolbarview > .top-bar:not(.raised) { background-color: var(--headerbar-bg-color); color: var(--headerbar-fg-color); }
toolbarview > .top-bar:not(.raised):backdrop { background-color: var(--headerbar-backdrop-color); }`;

/**
 * GTK 4 / libadwaita: both modes in one file. libadwaita 1.9 itself switches
 * with `@media (prefers-color-scheme: dark)`, which GTK 4.16+ answers from the
 * portal's color-scheme, so a running app follows Dark Mode without Dashi
 * rewriting anything. `--window-radius` is the corner libadwaita draws on a
 * window it decorates itself; it is the compositor's radius so the two agree.
 */
export function gtk4Colors(radius: number, accent: string | null = null): string {
  const light = gtkColors(false, accent);
  const dark = gtkColors(true, accent);
  return `${defineColors(light)}
@media (prefers-color-scheme: dark) {
${defineColors(dark, "  ")}
}
:root {
${customProperties(light, "  ")}
  --window-radius: ${radius}px;
}
@media (prefers-color-scheme: dark) {
  :root {
${customProperties(dark, "    ")}
  }
}
${FLAT_TOP_BARS}`;
}

/**
 * GTK 3: no media queries, so the mode in force. `adw-gtk3` and
 * `adw-gtk3-dark` are the theme (apps.ts); these names recolor either.
 */
export function gtk3Colors(dark: boolean, accent: string | null = null): string {
  return defineColors(gtkColors(dark, accent));
}

export function nearestAccent(hex: string): string {
  const rgb = (value: string): number[] => [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  const target = rgb(hex);
  const distance = (value: string): number => rgb(value).reduce((sum, channel, i) => sum + (channel - (target[i] ?? 0)) ** 2, 0);
  const [best] = Object.entries(GNOME_ACCENTS).reduce((a, b) => (distance(b[1]) < distance(a[1]) ? b : a));
  return best;
}
