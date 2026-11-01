/**
 * The summary graphs, drawn as SVG (Metal draws SVG; it has no canvas): a
 * series of values as a line over a washed area, scaled to the box. Several
 * series are separate drawings laid over each other, since the Svg element
 * tints a whole drawing one color.
 */

const round = (n: number): string => String(Math.round(n * 10) / 10);

/**
 * `values` (oldest first) as an area and its top line, right-aligned in a
 * `width` × `height` box that holds `slots` points, `max` at the top.
 */
export function sparkline(values: readonly number[], max: number, width: number, height: number, slots = 60): string {
  const top = max > 0 ? max : 1;
  const step = width / Math.max(slots - 1, 1);
  const start = width - (values.length - 1) * step;
  const points = values.map((value, index) => {
    const y = height - (Math.min(Math.max(value, 0), top) / top) * height;
    return `${round(start + index * step)},${round(y)}`;
  });
  const body =
    points.length < 2
      ? ""
      : `<path d="M${round(start)},${height} L${points.join(" L")} L${round(width)},${height} Z" fill="#000" fill-opacity="0.28"/>` +
        `<path d="M${points.join(" L")}" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
}

/** The top of a rate graph: the largest value, rounded up to a 1-2-5 step so the scale doesn't jitter. */
export function niceMax(values: readonly number[], floor = 1): number {
  const largest = Math.max(floor, ...values);
  const magnitude = 10 ** Math.floor(Math.log10(largest));
  const step = [1, 2, 5, 10].find((n) => n * magnitude >= largest) ?? 10;
  return step * magnitude;
}

/** Two series stacked: the second drawn on top of the first (system under user). */
export function stacked(below: readonly number[], above: readonly number[]): number[] {
  return above.map((value, index) => value + (below[index] ?? 0));
}
