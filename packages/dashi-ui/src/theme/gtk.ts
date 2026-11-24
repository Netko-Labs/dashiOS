/**
 * Dashi's colours as GTK knows them (libadwaita's named colours, which
 * adw-gtk3 copies): the grounds comp's title bars paint, the status pairs,
 * and GNOME's own accents for the portal. The shell writes them into the
 * person's gtk.css (shell/src/shared/appearance/gtk-colors.ts), with the
 * person's accent drawn in.
 */

import { lightColors, TRUE_BLACK } from "./palette.ts";

/** The libadwaita named colors Dashi sets; the custom property is the same name with dashes. */
type GtkSurface = "window" | "view" | "headerbar" | "sidebar" | "secondary_sidebar" | "card" | "dialog" | "popover" | "thumbnail";
type GtkStatus = "accent" | "destructive" | "warning" | "success" | "error";
type GtkColorName =
  | `${GtkStatus}_${"bg" | "fg"}_color`
  | `${GtkSurface}_${"bg" | "fg"}_color`
  | `${"headerbar" | "sidebar" | "secondary_sidebar"}_backdrop_color`;
export type GtkNamedColors = Readonly<Record<GtkColorName, string>>;
export type GtkStatusColors = Pick<GtkNamedColors, `${GtkStatus}_${"bg" | "fg"}_color`>;

/**
 * Same in both modes: the accent, the destructive ume (comp's close light),
 * broth for warnings, a moss green that is not the accent for success, and
 * ume again for errors. libadwaita derives the readable text variants
 * (`accent_color`, `warning_color`, ...) from these, darker on light and
 * lighter on dark, so they are not set here.
 */
export const GTK_STATUS: GtkStatusColors = {
  accent_bg_color: lightColors.selection,
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

export const GTK_LIGHT: GtkNamedColors = {
  ...GTK_STATUS,
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

/**
 * True black (TRUE_BLACK in @dashi/ui): the window and the view are the
 * black ground, a headerbar and a sidebar the raised step comp paints a
 * focused title bar (#141417), the first lift when unfocused (#0B0B0D);
 * cards, dialogs and popovers the raised step; the ink 92% white.
 */
export const GTK_DARK: GtkNamedColors = {
  ...GTK_STATUS,
  window_bg_color: TRUE_BLACK.ground,
  window_fg_color: TRUE_BLACK.ink,
  view_bg_color: TRUE_BLACK.ground,
  view_fg_color: TRUE_BLACK.ink,
  headerbar_bg_color: TRUE_BLACK.raised,
  headerbar_fg_color: "rgba(236, 236, 238, 0.92)",
  headerbar_backdrop_color: TRUE_BLACK.lift,
  sidebar_bg_color: TRUE_BLACK.raised,
  sidebar_fg_color: TRUE_BLACK.ink,
  sidebar_backdrop_color: TRUE_BLACK.lift,
  secondary_sidebar_bg_color: TRUE_BLACK.lift,
  secondary_sidebar_fg_color: TRUE_BLACK.ink,
  secondary_sidebar_backdrop_color: TRUE_BLACK.lift,
  card_bg_color: TRUE_BLACK.raised,
  card_fg_color: TRUE_BLACK.ink,
  dialog_bg_color: TRUE_BLACK.raised,
  dialog_fg_color: TRUE_BLACK.ink,
  popover_bg_color: TRUE_BLACK.raised,
  popover_fg_color: TRUE_BLACK.ink,
  thumbnail_bg_color: TRUE_BLACK.raised,
  thumbnail_fg_color: TRUE_BLACK.ink,
};

/**
 * The GNOME accent the portal's `accent-color` can name that is nearest
 * `hex` (by distance in sRGB), for apps that read the portal instead of the
 * CSS. These are libadwaita's `--accent-*` values.
 */
export const GNOME_ACCENTS: Readonly<Record<string, string>> = {
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
