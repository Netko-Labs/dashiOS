/**
 * The surfaces the glass rounds drew (decisions.md D760 to D769): the lock as C · Split, the Dock, the
 * banners' lane and Control Center's Now Playing tile. Values only, gathered into `GLASS` (glass.ts):
 * nothing reads them yet but design.html (H24); y4 builds them and may move each beside its component.
 */

/**
 * The lock (C · Split, D760; every screen size, D806): the clock at the left edge (`clock`: 264 / 216 Inter
 * Display ExtraLight, hours over minutes), who signs in under it (initials `initials`, a field `field`
 * wide), and Today. Three shapes:
 *
 * - wide, a landscape screen at least `wideMin` wide (lock-v3 C's frame): `inset` from the edge (`insetWide`
 *   on a 1920-wide screen), the day's top `top`, who signs in `footer` above the foot, the thin power pills
 *   (`pill`) `powerBottom` above it; Today a full-height pane of regular glass `today` wide, its title
 *   `todayTitle` at `pane.top`, `pane.padding` in, a section's caption `pane.section` under what is above;
 * - pane, a landscape screen narrower (lock-v3 #narrow's pane, the owner's choice): the clock
 *   `narrow.scale` of the screen's height (at most `clock`), its line `narrow.line` of its size, `narrow.edge`
 *   in (`narrow.edgeWide` from `narrow.edgeWideFrom`), the day's top `narrow.top`, who signs in
 *   `narrow.whoGap` under the clock, the pills `narrow.powerBottom` above the foot; Today `clamp(W −
 *   panes.room, panes.min, panes.max)` wide, `panes.padding` in, its title at `panes.top`, three small
 *   widgets from `panes.three` inside, else two;
 * - vertical, a screen taller than it is wide: the day's top `narrow.topVertical`, the pills beside who signs
 *   in, Today a bottom sheet of regular glass `sheet.inset` in from the sides, radius `sheet.radius` at the
 *   top, `sheet.padding` in, open (about `sheet.open` tall) when there is room, else its `sheet.peek` peek
 *   with a grabber and a `sheet.chevron` chevron that opens it (no password: Today already shows).
 *
 * The field's go arrow is a `arrow` disc; a notification on Today `note` tall, the song `playing`, its
 * sleeve `sleeve`. The status row keeps a full band of frost `band` tall at the top.
 */
const LOCK = {
  clock: { size: 264, line: 216 },
  inset: 88,
  insetWide: 96,
  dayGap: 18,
  initials: 52,
  field: 280,
  today: 744,
  todayTitle: 24,
  wideMin: 1646,
  top: 104,
  footer: 315,
  powerBottom: 44,
  pill: { height: 28, glyph: 13, padding: 10 },
  arrow: 20,
  pane: { top: 92, padding: 46, section: 24 },
  narrow: { scale: 0.3, line: 0.82, edge: 64, edgeWide: 72, edgeWideFrom: 1280, top: 44, topVertical: 120, whoGap: 28, powerBottom: 24 },
  panes: { room: 600, min: 400, max: 744, padding: 28, top: 56, three: 520 },
  sheet: { inset: 12, radius: 18, padding: 20, top: 26, peek: 104, open: 676, grabber: 36, chevron: 32 },
  note: 54,
  playing: 76,
  sleeve: 52,
  band: 56,
} as const;

/**
 * The Dock (D764): radius `radius`; a hover label of regular glass `label.height` tall, `label.gap` above
 * the icon, after `label.delayMs`; a count badge and a download bar in ink; autohide shows nothing but a
 * `reveal.band` point band at the edge, which opens it after `reveal.restMs` at rest; magnification grows
 * the icon under the pointer to `magnify.peak` and its neighbours to `magnify.neighbour`, lifted
 * `magnify.lift`. The label is `label.radius` round with `label.padding` at its sides and at most
 * `label.maxWidth` wide; a count is a pill `badge.height` tall (at least as wide), `badge.padding` at its
 * sides, `badge.offset` out past the icon's top right corner, ringed `badge.ring` in the Dock's twin; the
 * download's plate sits `download.bottom` above the icon's foot, the bar `download.border` inside it.
 */
const DOCK = {
  radius: 20,
  label: { height: 26, gap: 8, delayMs: 300, radius: 9, padding: 11, maxWidth: 320 },
  badge: { height: 18, padding: 5, offset: 5, ring: 2 },
  download: { height: 6, inset: 6, bottom: 5, border: 1 },
  reveal: { band: 2, restMs: 250 },
  magnify: { peak: 1.42, neighbour: 1.18, lift: 12 },
} as const;

/**
 * Banners (NO-6, D729): regular glass `width` wide, radius `radius`, in their own lane left of the widget
 * column, top-aligned with it, newest on top, `gap` apart.
 */
const BANNER = { width: 356, radius: 18, gap: 8 } as const;

/** Control Center's Now Playing tile (CC-7, D765): a pill `height` tall on a fill, the sleeve a `sleeve` disc. */
const NOW_PLAYING = { height: 56, sleeve: 44 } as const;

export const GLASS_SURFACES = { lock: LOCK, dock: DOCK, banner: BANNER, nowPlaying: NOW_PLAYING } as const;
