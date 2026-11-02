/**
 * Monochrome menu bar glyphs (tinted by the Svg `color`). The logo is a bowl
 * of dashi with steam. The status glyphs are drawn for their state: Wi-Fi
 * arcs, the speaker's waves, and the battery's fill change with the system.
 */

import type { Bars, Network } from "./system/network.ts";

export const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1.5 8.25h13a6.5 6 0 0 1-13 0z" fill="#000"/><path d="M5 1.75c-.9 1 .9 1.9 0 2.9M8 1.25c-.9 1 .9 1.9 0 2.9M11 1.75c-.9 1 .9 1.9 0 2.9" stroke="#000" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;

/** Parts of a glyph that are off stay visible, faintly, as on the Mac. */
const DIM = 0.28;

const svg = (viewBox: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
const stroke = (d: string, width: number, opacity = 1) =>
  `<path d="${d}" stroke="#000" stroke-opacity="${opacity}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Wi-Fi: three arcs (outer first) and the dot; `bars` of them lit. */
export function wifiGlyph(bars: Bars | "offline"): string {
  const lit = bars === "offline" ? 0 : bars;
  const arcs = [
    ["M6 11.1a2.9 2.9 0 0 1 4 0", 1],
    ["M3.6 8.6a6.3 6.3 0 0 1 8.8 0", 2],
    ["M1.2 6.1a9.8 9.8 0 0 1 13.6 0", 3],
  ] as const;
  return svg(
    "0 0 16 16",
    [
      ...arcs.map(([d, need]) => stroke(d, 1.6, lit >= need ? 1 : DIM)),
      `<circle cx="8" cy="13.4" r="1.2" fill="#000"${bars === "offline" ? ` fill-opacity="${DIM}"` : ""}/>`,
      bars === "offline" ? stroke("M2.5 2.2l11 11.6", 1.6) : "",
    ].join(""),
  );
}

/** A wired connection: an Ethernet port. */
export const ETHERNET = svg("0 0 16 16", stroke("M2.5 4.5h11v6.2h-2.3v2.3H4.8v-2.3H2.5z", 1.4) + stroke("M5.6 7v1.9M8 7v1.9M10.4 7v1.9", 1.2));

/** The glyph for what the network is doing. */
export function networkGlyph(network: Network): string {
  switch (network.kind) {
    case "wired":
      return ETHERNET;
    case "wifi":
      return wifiGlyph(network.bars);
    case "offline":
      return wifiGlyph("offline");
  }
}

/** The speaker: no waves when silent, one when low, two otherwise, a cross when muted. */
export function speakerGlyph(level: number, muted: boolean): string {
  const body = `<path d="M2 6h2.6L8 3v10L4.6 10H2z" fill="#000"/>`;
  if (muted) return svg("0 0 16 16", body + stroke("M10.8 6.2l3.6 3.6M14.4 6.2l-3.6 3.6", 1.4));
  const waves = [level > 0 ? stroke("M10.4 5.6a3.4 3.4 0 0 1 0 4.8", 1.4) : "", level >= 1 / 3 ? stroke("M12.3 3.8a6 6 0 0 1 0 8.4", 1.4) : ""];
  return svg("0 0 16 16", body + waves.join(""));
}

/** The battery, filled to `percent`; a bolt is cut out of it while charging. */
/** `charge`: true draws the bolt (charging), "plugged" a plug (on power, holding its charge). */
export function batteryGlyph(percent: number, charge: boolean | "plugged"): string {
  const x = 2.4;
  const y = 2.4;
  const height = 7.2;
  const width = percent > 0 ? Math.max((13.5 * Math.min(percent, 100)) / 100, 1.6) : 0;
  const r = Math.min(1.4, width / 2);
  const round = (n: number) => Number(n.toFixed(2));
  const fill = width
    ? `M${round(x + r)} ${y}H${round(x + width - r)}a${round(r)} ${round(r)} 0 0 1 ${round(r)} ${round(r)}V${round(y + height - r)}a${round(r)} ${round(r)} 0 0 1 -${round(r)} ${round(r)}H${round(x + r)}a${round(r)} ${round(r)} 0 0 1 -${round(r)} -${round(r)}V${round(y + r)}a${round(r)} ${round(r)} 0 0 1 ${round(r)} -${round(r)}z`
    : "";
  // With even-odd filling the bolt is a hole where it crosses the fill and
  // solid where it does not, so it reads at every level.
  const bolt =
    charge === true
      ? "M12.6 2.6L8.3 6.6h2.5l-.9 2.9 4.4-4.5h-2.6z"
      : charge === "plugged"
        ? "M9.5 2.4h.9v2h-.9zM11.6 2.4h.9v2h-.9zM8.8 4.4h4.4v1.8a2.2 2.2 0 0 1-1.6 2.1v1.4h-1.2V8.3a2.2 2.2 0 0 1-1.6-2.1z"
        : "";
  return svg(
    "0 0 24 12",
    `<rect x="0.75" y="0.75" width="20" height="10.5" rx="2.6" stroke="#000" stroke-opacity="0.45" stroke-width="1.2" fill="none"/>` +
      (fill || bolt ? `<path d="${fill}${bolt}" fill="#000" fill-rule="evenodd"/>` : "") +
      `<path d="M22.4 4.2v3.6a1.9 1.9 0 0 0 0-3.6z" fill="#000" fill-opacity="0.45"/>`,
  );
}

/** Brightness: a sun. */
export const SUN = (() => {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI) / 4;
    const point = (radius: number) => `${(8 + radius * Math.cos(angle)).toFixed(2)} ${(8 + radius * Math.sin(angle)).toFixed(2)}`;
    return `M${point(5.4)}L${point(7.2)}`;
  }).join("");
  return svg("0 0 16 16", `<circle cx="8" cy="8" r="2.9" fill="#000"/>${stroke(rays, 1.4)}`);
})();

/** The microphone, slashed when muted. */
export function micGlyph(muted: boolean): string {
  return svg(
    "0 0 16 16",
    `<rect x="5.8" y="1.2" width="4.4" height="8.4" rx="2.2" fill="#000"/>` +
      stroke("M3.4 7.6a4.6 4.6 0 0 0 9.2 0M8 12.2v2.4M5.6 14.6h4.8", 1.3) +
      (muted ? stroke("M2.4 2l11.2 12", 1.6) : ""),
  );
}

/** Control Center: two toggle pills, each with its knob. */
export const CONTROL_CENTER = svg(
  "0 0 16 16",
  `<rect x="1.4" y="2.2" width="13.2" height="5" rx="2.5" stroke="#000" stroke-width="1.3" fill="none"/><circle cx="4.2" cy="4.7" r="1.4" fill="#000"/>` +
    `<rect x="1.4" y="8.8" width="13.2" height="5" rx="2.5" stroke="#000" stroke-width="1.3" fill="none"/><circle cx="11.8" cy="11.3" r="1.4" fill="#000"/>`,
);
