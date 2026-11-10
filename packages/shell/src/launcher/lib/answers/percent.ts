/**
 * Percentages the way a till and a person mean them, over the sums of
 * launcher/lib/math.ts (which already reads `15% of 80`): `80 + 15%` is 92,
 * `80 - 15%` is 68, `20% off 80` is 64, `15 is what % of 60` is 25%. The text
 * is canonical already (numbers.ts): a `.` decimal point, no grouping.
 */

import { calculate } from "../math.ts";

const NUMBER = String.raw`\d+(?:\.\d+)?`;
const PLUS = new RegExp(String.raw`^(.+?)\s*([+\-−])\s*(${NUMBER})\s*%$`);
const OFF = new RegExp(String.raw`^(${NUMBER})\s*%\s*off\s+(?:of\s+)?(.+)$`, "i");
const SHARE = new RegExp(String.raw`^(${NUMBER})\s+is\s+what\s*%\s*of\s+(${NUMBER})$`, "i");

/** A number or a sum. */
function valueOf(text: string): number | null {
  const trimmed = text.trim();
  if (new RegExp(`^${NUMBER}$`).test(trimmed)) return Number(trimmed);
  return calculate(trimmed);
}

export interface PercentAnswer {
  value: number;
  /** The answer is itself a percentage (`25%`). */
  isShare: boolean;
}

/** The answer when `text` is one of the percentage forms above, else null. */
export function percentAnswer(text: string): PercentAnswer | null {
  const plus = PLUS.exec(text);
  if (plus) {
    const base = valueOf(plus[1] as string);
    const rate = Number(plus[3]);
    if (base !== null) return { value: tidy(base * (1 + ((plus[2] === "+" ? 1 : -1) * rate) / 100)), isShare: false };
  }
  const off = OFF.exec(text);
  if (off) {
    const base = valueOf(off[2] as string);
    if (base !== null) return { value: tidy(base * (1 - Number(off[1]) / 100)), isShare: false };
  }
  const share = SHARE.exec(text);
  if (share) {
    const whole = Number(share[2]);
    if (whole !== 0) return { value: tidy((Number(share[1]) / whole) * 100), isShare: true };
  }
  return null;
}

const tidy = (value: number): number => Number(value.toFixed(8));
