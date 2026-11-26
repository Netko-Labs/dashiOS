/**
 * Every measure Dashi draws with, beside the colours (docs/design.html TK-1):
 * type by role, weights, spacing, radii, shadows, opacity and motion. A
 * number in a style is one of these, never a literal (H21); a measure stated
 * for one component (MENU's padding 5, the sidebar's gap 9) is a named
 * constant beside that component instead.
 *
 * Three looks share them (TK-2): the app look (windows and sheets), the panel
 * look (Settings, Control Center, the battery panel, the menu bar, the
 * capsule, the launcher's conversation, the Installer: TYPE.panel and the
 * named radii), and the inks (the widget area, the lock, Glance: TYPE.inks).
 * Text size multiplies every TYPE role through `useType()` (type.ts).
 */

/** A role's size and the line it sits on, in points. */
export interface TypeRole {
  readonly size: number;
  readonly line: number;
}

const role = (size: number, line: number): TypeRole => ({ size, line });

/** TY-1: two rows of sizes and three named ones. No other sizes. */
export const TYPE = {
  /** 11: details, captions, section heads (600), table titles, a chip. */
  caption: role(11, 14),
  /** 12: secondary text, a sheet's message, a shortcut, a field's line. */
  secondary: role(12, 16),
  /** 13: body, labels, buttons, toolbar and window titles, every sheet's question (700). */
  body: role(13, 17),
  /** 15: an empty state's title; the login screen's name. */
  heading: role(15, 20),
  /** 17: the launcher's field. */
  field: role(17, 22),
  /** 20: a page's title (Setup, the Installer, About, a Store item). */
  title: role(20, 26),
  /** 28: a hero's one figure (the battery's charge). */
  figure: role(28, 34),
  /** 120 Inter Display ExtraLight, hours over minutes: the lock, the login screen and Glance (Q1). */
  clock: role(120, 112),
  /** The panel look's row (Q5). */
  panel: {
    /** 10.5: group labels, a round tile's word, hints, keycaps (600). */
    micro: role(10.5, 13),
    /** 11.5: a row's line, captions, the bar's words, a failure. */
    detail: role(11.5, 15),
    /** 12.5: pills' words (600), fields, a link, the card's message. */
    body: role(12.5, 16),
    /** 13.5: a row's name, the card's question, the conversation (600). */
    name: role(13.5, 18),
    /** 18: Settings' pane title (600). */
    title: role(18, 24),
  },
  /** The Inks' words (the widget area, the lock, Glance). */
  inks: {
    /** 9.5: a widget's label (600). */
    label: role(9.5, 12),
    /** 10.5: small words. */
    small: role(10.5, 13),
    /** 12.5: a widget's body. */
    body: role(12.5, 16),
  },
} as const;

export type TypeSet = typeof TYPE;

/**
 * TY-2: three weights for words; Inter Display's 200 to 500 for numbers only
 * (the clock at 200, the Inks' numbers), never for a word. Metal's names.
 */
export const WEIGHT = {
  regular: "normal",
  semibold: "semibold",
  bold: "bold",
  display: { extraLight: "extralight", light: "light", regular: "normal", medium: "medium" },
} as const;

/** The spacing steps (TK-1). Negatives are the negative step. */
export const SPACE = {
  /** 1: pills 1 apart, a hairline's offset. */
  px: 1,
  /** 2: a glyph beside its word, a ring's room. */
  xxs: 2,
  /** 4: tight stacks, a menu hung under its button. */
  xs: 4,
  /** 6: a word after a glyph, a tick column's gap. */
  s: 6,
  /** 8: the default gap: buttons, a sheet's buttons, list rows. */
  m: 8,
  /** 10: a sheet's gap, cards 10 apart. */
  gap: 10,
  /** 12: a row's inset, a panel's padding, separators' inset. */
  inset: 12,
  /** 14: a button's padding, the alert's gap. */
  button: 14,
  /** 16: a page's inset (Settings' rows), a sheet kept from the window's sides. */
  page: 16,
  /** 20: a sheet's padding. */
  sheet: 20,
  /** 24: a page's section gap, empty-state stacks. */
  xl: 24,
} as const;

/** RA-1: radii nest, plus the named surfaces. Nothing else. */
export const RADIUS = {
  /** 2: thumbnails, the marquee, a tick's box. */
  thumb: 2,
  /** 4: a checkbox, an alias badge. */
  check: 4,
  /** 5: a menu row, a table row, a small control, a code block. */
  row: 5,
  /** 7: a button, a field, a pop-up, a pick row, a sidebar row. */
  control: 7,
  /** 9: menus and pop-up menus. */
  menu: 9,
  /** 10: a group or card, the alert tile. */
  card: 10,
  /** 12: a window (the person's choice), a sheet, the launcher, every panel that asks or lists (RA-2). */
  sheet: 12,
  /** 18: a widget on paper glass (CO-11, D720); 14 for one row. */
  inkCard: 18,
  inkCardRow: 14,
  /** 17.5: the capsule's card (pill-v2). */
  capsuleCard: 17.5,
  /** 18: the Dock. */
  dock: 18,
  /** 10.5: an app icon on its 44 tile. */
  icon: 10.5,
  /** 24: Settings' cards (the panel look). */
  panelCard: 24,
  /** 28: Control Center, a Settings hero, the battery panel and the OSD. */
  panel: 28,
} as const;

/** A pill: half its height (chips, pills, Control Center's tiles, the bar's capsules). */
export const pill = (height: number): number => height / 2;

/** DE-1: three shadows, Metal's presets. No md, no xs. */
export const SHADOW = {
  /** Controls, cards, a knob, a lifted event, Segmented's chosen segment. */
  sm: "sm",
  /** Sheets, menus, popovers, suggestions, a drag ghost; floating glass: the launcher, banners, the capsule's card. */
  xl: "xl",
  /** Floating HUDs over the desktop: the capsule's line, the OSD. */
  lg: "lg",
} as const;

export type ShadowToken = (typeof SHADOW)[keyof typeof SHADOW];

/** Opacity has five jobs. Text never uses it for mutedness: `textMuted` is a colour. */
export const OPACITY = {
  /** 0.4: a whole control, disabled (UI-4). */
  disabled: 0.4,
  /** 0.5: not running or paused, a scrolled-back bar. */
  half: 0.5,
  /** 0.6: a glyph or mark at rest that is not text. */
  faint: 0.6,
  /** 0.75: secondary words on a tile. */
  soft: 0.75,
  /** 0.85: a round tile's word. */
  strong: 0.85,
} as const;

/** The Motion table's durations, in ms (MO-1: 300 at most for a transition). */
export const MOTION = {
  /** 80: a stepped indeterminate bar, a spinner's step. */
  step: 80,
  /** 120: a list's height, a job ring's step, a key's light. */
  quick: 120,
  /** 160: the launcher opening. */
  open: 160,
  /** 180: the Dock leaving. */
  exit: 180,
  /** 220: Overview opening, a Control Center tile (spring). */
  base: 220,
  /** 250: a Desktop switch, Overview closing. */
  slide: 250,
  /** 300: minimize and restore; MO-1's ceiling. */
  long: 300,
  /** 320: the voice chip's dots. */
  pulse: 320,
  /** 350: the capsule keeping its window (CP-9). */
  linger: 350,
  /** The Dock's entrance. */
  dockPanel: 420,
  dockIcon: 380,
  dockAll: 640,
  /** Night Shift's fade. */
  nightShift: 1500,
} as const;

/** How long before something shows, in ms. */
export const DELAY = {
  /** 150: the switcher appears. */
  hold: 150,
  /** 200: Loading shows (PA-5). */
  wait: 200,
  /** 500: a card's buttons arm (CP-4). */
  arm: 500,
  /** 600: a tooltip. */
  tooltip: 600,
} as const;

/** Past 1 a little and back (an underdamped spring, settled at t = 1): the Dock's icons, Control Center's tiles. */
function spring(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-6 * t) * Math.cos(9 * t) * (1 - t ** 8);
}

/** The curves, as functions of t (0..1). */
export const CURVE = {
  /** Ease-out cubic: the default. */
  out: (t: number): number => 1 - (1 - t) ** 3,
  /** Ease-in cubic: exits. */
  in: (t: number): number => t ** 3,
  /** Ease-in-out quad: the Dock's slide. */
  inOut: (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  /** Ease-out quint: the Dock's panel. */
  outQuint: (t: number): number => 1 - (1 - t) ** 5,
  /** The documented spring. */
  spring,
} as const;
