/**
 * Dashi's colors as GTK knows them. libadwaita (and adw-gtk3, which copies its
 * names) paints every surface from a handful of named colors: window, view,
 * headerbar, sidebar, card, popover, dialog, and the accent, destructive,
 * warning, success, and error pairs. Setting those in the person's gtk.css
 * re-colors every GNOME app at once, so Files or Text Editor beside a
 * Dashi-decorated window read as one desktop: the headerbar is the very color
 * comp/src/theme.rs paints a title bar (#EEEBE4 / #2C2C2E active, #F6F4EF /
 * #242426 inactive), the accent is the shell's kombu (theme.ts `selection`),
 * and destructive is ume.
 *
 * Two spellings, because versions differ: `@define-color window_bg_color`
 * (every libadwaita, and GTK 3) and the custom property `--window-bg-color`
 * (libadwaita 1.6+, which maps one to the other at `:root`, so either works
 * there; both are written so a version that reads only one still follows).
 */

import { CORNER_RADIUS, DEFAULT_CORNERS } from "../corners.ts";
import { lightColors } from "@dashi/ui";

/** What the block depends on: Dark Mode and the Appearance setting's window corners. */
export interface GtkStyle {
  dark: boolean;
  /** Logical pixels; the compositor rounds every window to the same radius (IPC `chrome {radius}`). */
  radius: number;
}

export const DEFAULT_STYLE: GtkStyle = { dark: false, radius: CORNER_RADIUS[DEFAULT_CORNERS] };

/** The libadwaita named colors Dashi sets; the custom property is the same name with dashes. */
type Surface = "window" | "view" | "headerbar" | "sidebar" | "secondary_sidebar" | "card" | "dialog" | "popover" | "thumbnail";
type Status = "accent" | "destructive" | "warning" | "success" | "error";
type ColorName =
  | `${Status}_${"bg" | "fg"}_color`
  | `${Surface}_${"bg" | "fg"}_color`
  | `${"headerbar" | "sidebar" | "secondary_sidebar"}_backdrop_color`;
export type NamedColors = Readonly<Record<ColorName, string>>;
type StatusColors = Pick<NamedColors, `${Status}_${"bg" | "fg"}_color`>;

/** The accent: the shell's kombu green, the color of a selected row in every Dashi list. */
export const ACCENT = lightColors.selection;

/**
 * Same in both modes: the accent, the destructive ume (comp's close light),
 * broth for warnings, a moss green that is not the accent for success, and
 * ume again for errors. libadwaita derives the readable text variants
 * (`accent_color`, `warning_color`, ...) from these, darker on light and
 * lighter on dark, so they are not set here.
 */
const STATUS: StatusColors = {
  accent_bg_color: ACCENT,
  accent_fg_color: "#ffffff",
  destructive_bg_color: "#D0596F",
  destructive_fg_color: "#ffffff",
  warning_bg_color: "#E5B13F",
  warning_fg_color: "rgba(0, 0, 0, 0.8)",
  success_bg_color: "#4F9A3E",
  success_fg_color: "#ffffff",
  error_bg_color: "#D0596F",
  error_fg_color: "#ffffff",
};

const LIGHT: NamedColors = {
  ...STATUS,
  window_bg_color: "#FAF9F6",
  window_fg_color: "#1D1D1F",
  view_bg_color: "#FFFFFF",
  view_fg_color: "#1D1D1F",
  // comp's LIGHT title bar: active, then inactive, with its title ink.
  headerbar_bg_color: "#EEEBE4",
  headerbar_fg_color: "rgba(29, 35, 32, 0.92)",
  headerbar_backdrop_color: "#F6F4EF",
  sidebar_bg_color: "#EEEBE4",
  sidebar_fg_color: "#1D1D1F",
  sidebar_backdrop_color: "#F6F4EF",
  secondary_sidebar_bg_color: "#F3F1EC",
  secondary_sidebar_fg_color: "#1D1D1F",
  secondary_sidebar_backdrop_color: "#F8F6F2",
  card_bg_color: "#FFFFFF",
  card_fg_color: "#1D1D1F",
  dialog_bg_color: "#FAF9F6",
  dialog_fg_color: "#1D1D1F",
  popover_bg_color: "#FFFFFF",
  popover_fg_color: "#1D1D1F",
  thumbnail_bg_color: "#FFFFFF",
  thumbnail_fg_color: "#1D1D1F",
};

/** Graphite, as comp's DARK title bar (#2C2C2E, #242426) and the shell's #F5F5F7 ink. */
const DARK: NamedColors = {
  ...STATUS,
  window_bg_color: "#1F1F21",
  window_fg_color: "#F5F5F7",
  view_bg_color: "#19191A",
  view_fg_color: "#F5F5F7",
  headerbar_bg_color: "#2C2C2E",
  headerbar_fg_color: "rgba(245, 245, 247, 0.9)",
  headerbar_backdrop_color: "#242426",
  sidebar_bg_color: "#2C2C2E",
  sidebar_fg_color: "#F5F5F7",
  sidebar_backdrop_color: "#242426",
  secondary_sidebar_bg_color: "#262628",
  secondary_sidebar_fg_color: "#F5F5F7",
  secondary_sidebar_backdrop_color: "#232325",
  card_bg_color: "rgba(255, 255, 255, 0.08)",
  card_fg_color: "#F5F5F7",
  dialog_bg_color: "#2C2C2E",
  dialog_fg_color: "#F5F5F7",
  popover_bg_color: "#2C2C2E",
  popover_fg_color: "#F5F5F7",
  thumbnail_bg_color: "#2C2C2E",
  thumbnail_fg_color: "#F5F5F7",
};

export function gtkColors(dark: boolean): NamedColors {
  return dark ? DARK : LIGHT;
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
export function gtk4Colors(radius: number): string {
  return `${defineColors(LIGHT)}
@media (prefers-color-scheme: dark) {
${defineColors(DARK, "  ")}
}
:root {
${customProperties(LIGHT, "  ")}
  --window-radius: ${radius}px;
}
@media (prefers-color-scheme: dark) {
  :root {
${customProperties(DARK, "    ")}
  }
}
${FLAT_TOP_BARS}`;
}

/**
 * GTK 3: no media queries, so the mode in force. `adw-gtk3` and
 * `adw-gtk3-dark` are the theme (apps.ts); these names recolor either.
 */
export function gtk3Colors(dark: boolean): string {
  return defineColors(gtkColors(dark));
}

/**
 * The GNOME accent the portal's `accent-color` can name that is nearest
 * `hex` (by distance in sRGB), for apps that read the portal instead of the
 * CSS. These are libadwaita's `--accent-*` values.
 */
const GNOME_ACCENTS: Readonly<Record<string, string>> = {
  blue: "#3584e4",
  teal: "#2190a4",
  green: "#3a944a",
  yellow: "#c88800",
  orange: "#ed5b00",
  red: "#e62d42",
  pink: "#d56199",
  purple: "#9141ac",
  slate: "#6f8396",
};

export function nearestAccent(hex: string): string {
  const rgb = (value: string): number[] => [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
  const target = rgb(hex);
  const distance = (value: string): number => rgb(value).reduce((sum, channel, i) => sum + (channel - (target[i] ?? 0)) ** 2, 0);
  const [best] = Object.entries(GNOME_ACCENTS).reduce((a, b) => (distance(b[1]) < distance(a[1]) ? b : a));
  return best;
}
