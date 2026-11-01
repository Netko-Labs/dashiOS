/**
 * The Dock's settings, `dock` in settings.json: how it looks (the floating
 * Dock or a full-width taskbar), whether it hides until the pointer reaches
 * the screen's bottom edge, and whether it is shown at all. The shell's
 * parser (settings.ts) and System Settings' store (settings-app/store.ts)
 * both read the file; the keys, defaults, and checks live here so they
 * cannot disagree.
 *
 *   "dock": { "style": "taskbar", "autohide": true, "visible": true }
 */

export const DOCK_STYLES = ["dock", "taskbar"] as const;
export type DockStyle = (typeof DOCK_STYLES)[number];

export interface DockSettings {
  style: DockStyle;
  /** The Dock slides out of view and gives its space back to windows. */
  autohide: boolean;
  /** Off: no Dock at all, until it is turned on again (System Settings, or the Dock's menu while it is up). */
  visible: boolean;
}

export const DOCK_DEFAULTS: Readonly<DockSettings> = { style: "dock", autohide: false, visible: true };

/** The keys `dock` may hold. */
export const DOCK_KEYS = ["style", "autohide", "visible"] as const;

export const isDockStyle = (value: unknown): value is DockStyle => DOCK_STYLES.some((style) => style === value);

/** The settings a file's `dock` section amounts to: each key that holds a value of the right kind, the default for the rest. */
export function resolveDock(section: Partial<Record<keyof DockSettings, unknown>> = {}): DockSettings {
  return {
    style: isDockStyle(section.style) ? section.style : DOCK_DEFAULTS.style,
    autohide: typeof section.autohide === "boolean" ? section.autohide : DOCK_DEFAULTS.autohide,
    visible: typeof section.visible === "boolean" ? section.visible : DOCK_DEFAULTS.visible,
  };
}

export const sameDock = (a: DockSettings, b: DockSettings): boolean => a.style === b.style && a.autohide === b.autohide && a.visible === b.visible;
