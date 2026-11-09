/** Dashi's colors, in a light and a dark set that fill the same names. */

/** Every color the shell paints with; light and dark fill the same names. */
export interface Palette {
  text: string;
  textMuted: string;
  /** Ink for what can't be used right now: a dimmed menu row or button. */
  textDisabled: string;
  menuBar: string;
  /** The hairline along the menu bar's bottom edge, as on the Mac: it is what separates glass from windows. */
  menuBarEdge: string;
  dock: string;
  dockBorder: string;
  hover: string;
  separator: string;
  dot: string;
  /** Glass for overlays that hold text (launcher, shortcut sheet): more tint. */
  launcher: string;
  /** Dropdowns and Control Center: nearly opaque, since nothing blurs what is behind them yet. */
  menu: string;
  /** Every menu's edge, the menu bar's and a window's alike: a dark hairline in Light, true black's 12% edge in Dark, where a shadow has nothing to darken. */
  menuEdge: string;
  /** The on-screen display (volume, brightness): glass with ink segments. */
  osd: string;
  osdOn: string;
  osdOff: string;
  /** A battery at its last few percent: ume, as `critical`. */
  batteryLow: string;
  /**
   * Kombu, the person's color: the selected row, a chosen pill, a switch
   * that is on, the one primary button. White text on it is AA (5.1:1), so
   * it is a little deeper than the brand's #3E8A72. Never a decoration, a
   * hover, or an icon at rest.
   */
  selection: string;
  /** Kombu under the pointer, and pressed: a primary button deepens, never lightens, so white on it stays AA. */
  selectionHover: string;
  selectionPressed: string;
  /**
   * A selected row in a list, a table or a sidebar (the launcher, every app:
   * selection.tsx, CO-9): a 14% kombu wash
   * behind ink, with a 3 px `selectionBar` at the row's left edge. Ink on it
   * passes CO-6 in both modes, over any wallpaper.
   */
  selectionWash: string;
  /**
   * Selected text in a field (CO-9): kombu washed deeper than a row's
   * `selectionWash`, since it has no bar to mark it, so a word or two stands
   * out at least 1.3:1 from every window ground. The field's own ink stays
   * on it (well over 4.5:1).
   */
  textSelection: string;
  /**
   * The 3 px bar on a `selectionWash` row: `selection` in light mode, the
   * brand's lighter kombu in Dark Mode, where the deeper `selection` would
   * stand out only 2.6:1 on the launcher's glass.
   */
  selectionBar: string;
  /** Text on `selectionWash`. */
  onSelection: string;
  /**
   * The focus ring (KB-2): kombu, 2 px wide and 2 px out from the control,
   * only after the keyboard moved focus. The brand's lighter kombu in Dark
   * Mode, so it stands 3:1 on every window ground.
   */
  focusRing: string;
  /** The chosen app in the switcher, and an open menu bar item: a soft wash. */
  switcherSelection: string;
  /** Secondary buttons' fill (and a hover wash); their edge is `controlEdge`. */
  button: string;
  /** The edge of a secondary button: at least 3:1 against the window, the sidebar, and a card. */
  controlEdge: string;
  /** A secondary control while it is held down: deeper than its hover (UI-4). */
  pressed: string;
  checkbox: string;
  /** Urgent things (a critical notification's mark): ume, the same value as `ume`. Prefer `ume` in new code. */
  critical: string;
  /** Ume, for closing, destroying, and errors: error text and a destructive action's words, AA on every window ground. */
  ume: string;
  /** Ume under white text: a destructive button (5.1:1). */
  umeFill: string;
  /** A destructive button under the pointer, and pressed: deeper ume, white still AA. */
  umeFillHover: string;
  umeFillPressed: string;
  /** Ume washed: the tile behind a destructive sheet's glyph. */
  umeWash: string;
  /** Broth, for caution and setting aside: warning text, AA on every window ground. */
  broth: string;
  /** Broth washed: behind a warning's glyph. */
  brothWash: string;
  /**
   * Find's matches in a document's text (Text Editor): broth washed behind
   * the words, and deeper on the match Find is on (`findCurrent`), under the
   * text's own ink (at least 4.5:1 on both) and apart from kombu's selection.
   */
  findWash: string;
  findCurrent: string;
  /** Moss, for success ("Installed", "Saved"): text, AA on every window ground. Not kombu: done is not selected. */
  moss: string;
  /**
   * Kombu as words: the verb on a store's pill (Get, Update) and a link,
   * AA on every window ground and on `button`. The brand's lighter kombu in
   * Dark Mode, where `selection` as text is too quiet.
   */
  accentInk: string;
  /** Flathub's seal behind a verified publisher's check (white on it). Flathub's mark, not Dashi's: only for "verified by Flathub". */
  verified: string;
  /** Words that destroy (Quit, Move to Trash) in the launcher: ume that reads at 4.5:1 on the glass and on `selectionWash`. */
  criticalInk: string;
  /** Tiles and cards on Control Center's panel. */
  tile: string;
  /** A card under the pointer. */
  tileHover: string;
  /** A slider's empty track, and an off switch's circle. */
  track: string;
  /** Shiso, agents' own color and only theirs: the pill, the consent sheet's mark. Never a decoration. */
  agent: string;
  agentInk: string;
  agentWash: string;
  /** The menu bar pill while the screen is being shared: ume, washed; its dot is `ume`. */
  captureWash: string;
  /**
   * An app is using the microphone: the menu bar's pill (its glyph, on the
   * wash) and the dot on Control Center's and Settings' rows. Orange, apart
   * from the red of a screen being seen; a glyph, 3:1 at least on the bar.
   */
  microphone: string;
  microphoneWash: string;
}

export const lightColors: Palette = {
  text: "#1d1d1f",
  textMuted: "#1d1d1fa6",
  textDisabled: "#1d1d1f55",
  menuBar: "#f5f5f7c7",
  menuBarEdge: "#0000002b",
  dock: "#f5f5f799",
  dockBorder: "#ffffff73",
  hover: "#ffffff59",
  separator: "#1d1d1f26",
  dot: "#1d1d1fcc",
  launcher: "#f5f5f7f5",
  menu: "#f6f6f8f7",
  menuEdge: "#1d1d1f26",
  osd: "#f5f5f7e0",
  osdOn: "#1d1d1fd9",
  osdOff: "#1d1d1f26",
  batteryLow: "#AD3F55",
  selection: "#357A64",
  selectionHover: "#2F6E5A",
  selectionPressed: "#29614F",
  selectionWash: "#3E8A7224",
  textSelection: "#3E8A7240",
  selectionBar: "#357A64",
  onSelection: "#1d1d1f",
  focusRing: "#357A64",
  switcherSelection: "#1d1d1f24",
  button: "#1d1d1f12",
  controlEdge: "#1d1d1f80",
  pressed: "#1d1d1f42",
  checkbox: "#1d1d1f66",
  critical: "#AD3F55",
  ume: "#AD3F55",
  umeFill: "#B8475C",
  umeFillHover: "#A94054",
  umeFillPressed: "#99394B",
  umeWash: "#D0596F24",
  broth: "#86600A",
  brothWash: "#E5B13F33",
  findWash: "#E5B13F40",
  findCurrent: "#E5B13F99",
  moss: "#38722C",
  accentInk: "#2F6E5A",
  verified: "#3B8FD0",
  criticalInk: "#963549",
  tile: "#ffffffb8",
  tileHover: "#ffffffe6",
  track: "#1d1d1f1f",
  agent: "#6E56CF",
  agentInk: "#3B2A8A",
  agentWash: "#6E56CF24",
  captureWash: "#D0596F24",
  microphone: "#B85A12",
  microphoneWash: "#E07A2A29",
};

/**
 * True black (AMOLED), Dark Mode's steps: the ground every window and page
 * paints, two near-black lifts for what sits on it (a sidebar, a field and a
 * stripe on `lift`; a card, a tile, a menu and a title bar on `raised`), the
 * ink at 92% white, and the hairlines (white at 10% between rows, 12% at an
 * edge) that stand in for shadows, which have nothing to darken on black.
 * Every Dark ground in Dashi comes from these: the palette and surfaces
 * below, Control Center's and Settings' controls, GTK's colors, Terminal,
 * and the compositor's title bars (`titlebar.rs`, checked by a test).
 */
export const TRUE_BLACK = {
  ground: "#000000",
  lift: "#0b0b0d",
  raised: "#141417",
  ink: "#ececee",
  hairline: "#ffffff1a",
  edge: "#ffffff1f",
} as const;

const { ground: BLACK, lift: LIFT, raised: RAISED, ink: INK, hairline: HAIRLINE, edge: EDGE } = TRUE_BLACK;

/**
 * True black: the ground is #000000, and what sits on it lifts by the
 * near-black steps above, edged in white hairlines. Muted ink is 60% of the
 * ink. Glass over the wallpaper (the menu bar, the Dock) is black, never a
 * smoky gray; glass that holds text over windows (the launcher, menus, the
 * on-screen display) is a lift, nearly opaque. The accent, ume, broth, moss
 * and shiso keep their jobs and their Dark inks.
 */
export const darkColors: Palette = {
  text: INK,
  textMuted: `${INK}99`,
  textDisabled: `${INK}55`,
  menuBar: `${BLACK}e6`,
  menuBarEdge: EDGE,
  dock: `${BLACK}cc`,
  dockBorder: EDGE,
  hover: "#ffffff1a",
  separator: HAIRLINE,
  dot: `${INK}cc`,
  launcher: `${LIFT}f5`,
  menu: `${RAISED}f7`,
  menuEdge: EDGE,
  osd: `${LIFT}e6`,
  osdOn: `${INK}d9`,
  osdOff: `${INK}26`,
  batteryLow: "#E8798F",
  selection: "#357A64",
  selectionHover: "#2F6E5A",
  selectionPressed: "#29614F",
  selectionWash: "#3E8A7238",
  textSelection: "#3E8A7280",
  selectionBar: "#3E8A72",
  onSelection: INK,
  focusRing: "#3E8A72",
  switcherSelection: "#ffffff24",
  button: "#ffffff1f",
  controlEdge: `${INK}66`,
  pressed: "#ffffff3d",
  checkbox: `${INK}66`,
  critical: "#E8798F",
  ume: "#E8798F",
  umeFill: "#B8475C",
  umeFillHover: "#A94054",
  umeFillPressed: "#99394B",
  umeWash: "#E8798F3d",
  broth: "#E5B13F",
  brothWash: "#E5B13F3d",
  findWash: "#E5B13F33",
  findCurrent: "#E5B13F73",
  moss: "#6CB45B",
  accentInk: "#7FD1B2",
  verified: "#3B8FD0",
  criticalInk: "#F09AAB",
  tile: "#ffffff17",
  tileHover: "#ffffff29",
  track: "#ffffff2e",
  agent: "#8B76E8",
  agentInk: "#cfc6f7",
  agentWash: "#8B76E83d",
  captureWash: "#E8798F3d",
  microphone: "#F0954A",
  microphoneWash: "#F0954A3d",
};

/** The palette for the Dark Mode switch. */
export function paletteFor(dark: boolean): Palette {
  return dark ? darkColors : lightColors;
}
