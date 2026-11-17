/**
 * The widgets' category glyphs (round five's set: a 16-point grid, 1.5
 * strokes, round caps), each a whole `<svg>` for Metal's `Svg`, which draws
 * it as a mask in one colour. The glyph carries a category wherever colour
 * alone would have to (the Rundown, the bar's capsules, Glance).
 */

const PATHS = {
  sun: '<circle cx="8" cy="8" r="3.2"/><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1"/>',
  cloud: '<path d="M4.6 12.5h6.9a2.9 2.9 0 0 0 .3-5.8 4 4 0 0 0-7.6 1A2.4 2.4 0 0 0 4.6 12.5z"/>',
  partly:
    '<path d="M6.2 3.6a2.6 2.6 0 0 1 3.9 1.6M4 2.4l.6.7M7.6 1v1M1.6 5.3h1"/><path d="M5.2 13.5h6.2a2.6 2.6 0 0 0 .3-5.2 3.6 3.6 0 0 0-6.8.9 2.2 2.2 0 0 0 .3 4.3z"/>',
  rain: '<path d="M4.6 9.8h6.9a2.6 2.6 0 0 0 .3-5.2 4 4 0 0 0-7.6 1A2.2 2.2 0 0 0 4.6 9.8z"/><path d="M5.5 12l-.7 1.8M8.3 12l-.7 1.8M11.1 12l-.7 1.8"/>',
  snow: '<path d="M4.6 9.8h6.9a2.6 2.6 0 0 0 .3-5.2 4 4 0 0 0-7.6 1A2.2 2.2 0 0 0 4.6 9.8z"/><path d="M5.5 12.6h.01M8.3 13.4h.01M11.1 12.6h.01" stroke-width="2"/>',
  storm: '<path d="M4.6 9.3h6.9a2.6 2.6 0 0 0 .3-5.2 4 4 0 0 0-7.6 1A2.2 2.2 0 0 0 4.6 9.3z"/><path d="M8.6 10.2 7 12.6h2.2l-1.4 2.2"/>',
  fog: '<path d="M2.5 6.5h11M3.5 9.5h9M2.5 12.5h11"/>',
  moon: '<path d="M12.8 10.2A5.4 5.4 0 0 1 5.8 3.2a5.4 5.4 0 1 0 7 7z"/>',
  bolt: '<path d="M9 1.5 3.8 9h4l-1 5.5L12.2 7h-4z"/>',
  play: '<path d="M5 3.2v9.6L12.6 8z" fill="#000"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9" stroke-width="2.2"/>',
  next: '<path d="M3 3.8v8.4L8.4 8zM8.4 3.8v8.4L13.8 8z" fill="#000" stroke-width="1"/>',
  prev: '<path d="M13 3.8v8.4L7.6 8zM7.6 3.8v8.4L2.2 8z" fill="#000" stroke-width="1"/>',
  timer: '<circle cx="8" cy="9" r="5.5"/><path d="M8 6v3l2 1.5M6.5 1.5h3"/>',
  note: '<path d="M4 2h6l2.5 2.5V14H4z"/><path d="M6.2 7h4M6.2 9.5h4M6.2 12h2.4"/>',
  cal: '<rect x="2" y="3" width="12" height="11" rx="2.2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/>',
  cpu: '<rect x="4" y="4" width="8" height="8" rx="1.5"/><path d="M6.5 1.5v2M9.5 1.5v2M6.5 12.5v2M9.5 12.5v2M1.5 6.5h2M1.5 9.5h2M12.5 6.5h2M12.5 9.5h2"/>',
  music: '<path d="M6 12.5V3.5l7-1.5v9"/><circle cx="4.2" cy="12.5" r="1.8"/><circle cx="11.2" cy="11" r="1.8"/>',
  plus: '<path d="M8 3v10M3 8h10" stroke-width="2"/>',
  x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  down: '<path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10"/>',
  lock: '<rect x="3" y="7" width="10" height="7.5" rx="2"/><path d="M5.3 7V5a2.7 2.7 0 0 1 5.4 0v2"/>',
  spark: '<path d="M8 1.8l1.5 4.2 4.2 1.5-4.2 1.5L8 13.2 6.5 9 2.3 7.5 6.5 6z" fill="#000" stroke-width="1"/>',
  globe: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/>',
  check: '<path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke-width="2"/>',
  msg: '<path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/>',
  box: '<path d="M2.5 5 8 2l5.5 3v6L8 14l-5.5-3z"/><path d="M2.5 5 8 8l5.5-3M8 8v6"/>',
  grab: '<path d="M4 6h8M4 10h8" stroke-width="1.6"/>',
  puzzle: '<path d="M3 5h3a1.5 1.5 0 1 1 3 0h3v3a1.5 1.5 0 1 0 0 3v2H3z"/>',
} as const;

export type GlyphName = keyof typeof PATHS;

/** Whether `name` is one of the glyphs (an extension's tree names them). */
export function isGlyphName(name: string): name is GlyphName {
  return Object.hasOwn(PATHS, name);
}

const cache = new Map<GlyphName, string>();

/** The glyph as a whole `<svg>`, tinted by `Svg`'s `color`. */
export function glyph(name: GlyphName): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  cache.set(name, markup);
  return markup;
}
