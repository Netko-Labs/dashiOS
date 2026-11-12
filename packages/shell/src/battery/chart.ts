/**
 * The battery monitor's charts as SVG (Metal draws SVG; it has no canvas),
 * over the last 24 hours in quarter-hour steps: the charge as an area, the
 * stretches on power as a band under it, and the draw as a line. Each is one
 * drawing tinted one color by the Svg element, so they are laid over each
 * other. Gaps (asleep, off) are left empty.
 */

import { type Sample, series } from "./history.ts";

const round = (n: number): string => String(Math.round(n * 10) / 10);

/** Runs of consecutive points that pass `keep`, as [index, value] lists. */
function runs(points: readonly (Sample | null)[], keep: (sample: Sample) => boolean, value: (sample: Sample) => number): [number, number][][] {
  const out: [number, number][][] = [];
  let current: [number, number][] = [];
  points.forEach((point, index) => {
    if (point && keep(point)) current.push([index, value(point)]);
    else if (current.length > 0) {
      out.push(current);
      current = [];
    }
  });
  if (current.length > 0) out.push(current);
  return out;
}

export interface ChartBox {
  width: number;
  height: number;
  now: number;
  span?: number;
  bucket?: number;
}

const frame = (box: ChartBox, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.width} ${box.height}" width="${box.width}" height="${box.height}">${body}</svg>`;

function geometry(box: ChartBox, count: number) {
  const step = box.width / Math.max(count - 1, 1);
  return { x: (index: number) => index * step, y: (fraction: number) => box.height - Math.min(Math.max(fraction, 0), 1) * box.height };
}

/** The charge over the day: an area under a line, 0 to 100%. */
export function levelChart(samples: readonly Sample[], box: ChartBox): string {
  const points = series(samples, box.now, box.span, box.bucket);
  const { x, y } = geometry(box, points.length);
  const body = runs(
    points,
    () => true,
    (sample) => sample.percent / 100,
  )
    .map((run) => {
      const line = run.map(([index, value]) => `${round(x(index))},${round(y(value))}`).join(" L");
      const first = run[0] as [number, number];
      const last = run.at(-1) as [number, number];
      const width = run.length === 1 ? 2 : 0;
      return `<path d="M${round(x(first[0]))},${box.height} L${line} L${round(x(last[0]) + width)},${round(y(last[1]))} L${round(x(last[0]) + width)},${box.height} Z" fill="#000" fill-opacity="0.22"/><path d="M${line}" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>`;
    })
    .join("");
  return frame(box, body);
}

/** Where it was on power: a band along the bottom (drawn in the charging color). */
export function chargingBand(samples: readonly Sample[], box: ChartBox, thickness = 3): string {
  const points = series(samples, box.now, box.span, box.bucket);
  const { x } = geometry(box, points.length);
  const body = runs(
    points,
    (sample) => sample.state !== "discharging",
    () => 0,
  )
    .map((run) => {
      const from = x((run[0] as [number, number])[0]);
      const to = Math.max(x((run.at(-1) as [number, number])[0]), from + 2);
      return `<rect x="${round(from)}" y="${box.height - thickness}" width="${round(to - from)}" height="${thickness}" rx="1.5" fill="#000"/>`;
    })
    .join("");
  return frame(box, body);
}

/** The draw while on battery, as a line, `max` watts at the top. */
export function drawChart(samples: readonly Sample[], box: ChartBox, max: number): string {
  const points = series(samples, box.now, box.span, box.bucket);
  const { x, y } = geometry(box, points.length);
  const top = max > 0 ? max : 1;
  const body = runs(
    points,
    (sample) => sample.state === "discharging" && sample.watts !== null,
    (sample) => (sample.watts ?? 0) / top,
  )
    .map((run) => {
      if (run.length === 1) {
        const [index, value] = run[0] as [number, number];
        return `<circle cx="${round(x(index))}" cy="${round(y(value))}" r="1.5" fill="#000"/>`;
      }
      return `<path d="M${run.map(([index, value]) => `${round(x(index))},${round(y(value))}`).join(" L")}" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>`;
    })
    .join("");
  return frame(box, body);
}

/** The top of the draw chart: the day's largest draw, rounded up to a whole 5 W (10 W at least). */
export function drawMax(samples: readonly Sample[]): number {
  const largest = Math.max(10, ...samples.flatMap((sample) => (sample.watts === null ? [] : [sample.watts])));
  return Math.ceil(largest / 5) * 5;
}

/**
 * The battery panel's "Charge, last 24 h": the charge as a line on a 0–100%
 * scale, the charge limit as a dashed line under a faint ink, gaps (asleep,
 * off) left empty. One color, tinted by the Svg element.
 */
export function chargeLine(samples: readonly Sample[], box: ChartBox, limit: number | null): string {
  const points = series(samples, box.now, box.span, box.bucket);
  const { x, y } = geometry(box, points.length);
  const dashed =
    limit !== null && limit < 100
      ? `<line x1="0" y1="${round(y(limit / 100))}" x2="${box.width}" y2="${round(y(limit / 100))}" stroke="#000" stroke-opacity="0.3" stroke-width="1" stroke-dasharray="2 3"/>`
      : "";
  const lines = runs(
    points,
    () => true,
    (sample) => sample.percent / 100,
  )
    .map((run) => {
      if (run.length === 1) {
        const [index, value] = run[0] as [number, number];
        return `<circle cx="${round(x(index))}" cy="${round(y(value))}" r="1.5" fill="#000"/>`;
      }
      return `<path d="M${run.map(([index, value]) => `${round(x(index))},${round(y(value))}`).join(" L")}" fill="none" stroke="#000" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join("");
  return frame(box, dashed + lines);
}
