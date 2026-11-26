/**
 * The surfaces the glass rounds drew (decisions.md D760 to D769): the lock as C · Split, the Dock, the
 * banners' lane and Control Center's Now Playing tile. Values only, gathered into `GLASS` (glass.ts):
 * nothing reads them yet but design.html (H24); y4 builds them and may move each beside its component.
 */

/**
 * The lock (C · Split, D760): the clock at the left edge (264 / 216 Inter Display ExtraLight, hours over
 * minutes, `inset` from the edge on the laptop, `insetWide` on a 1920-wide screen, the day `dayGap`
 * above), who signs in under it (initials `initials`, a field `field` wide), and Today: a full-height pane
 * of regular glass `today` wide at the right, its title `todayTitle` Inter Display SemiBold. Below
 * `splitMin` points wide the pane becomes a bottom sheet and the clock one line.
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
  splitMin: 1280,
} as const;

/**
 * The Dock (D764): radius `radius`; a hover label of regular glass `label.height` tall, `label.gap` above
 * the icon, after `label.delayMs`; a count badge and a download bar in ink; autohide shows nothing but a
 * `reveal.band` point band at the edge, which opens it after `reveal.restMs` at rest; magnification grows
 * the icon under the pointer to `magnify.peak` and its neighbours to `magnify.neighbour`, lifted
 * `magnify.lift`.
 */
const DOCK = {
  radius: 20,
  label: { height: 26, gap: 8, delayMs: 300 },
  download: { height: 6, inset: 6 },
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
