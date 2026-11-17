/**
 * Dots for indicators only (round five, #1): progress, histories, the
 * battery's limit, a run's steps, the tally. Never for letters or numbers.
 *
 * On a host that draws `<Dots>` (mirin PR #55, its `protocol` line says
 * `dots`) a row is one leaf the host paints in one go. Its box is
 * `(count − 1)·pitch + 2r`; Dashi's is `count·pitch`, each dot centred in its
 * cell, so it is padded by `pitch/2 − r` all round and every layout stays as
 * it was. On an older host a row is two `Svg` masks stacked: the lit dots in
 * the ink and the unlit ones in the quiet tone, built once per value step.
 */

import { Dots, Svg, View } from "@mirinjs/metal";
import { memo } from "react";
import { useHostAbilities } from "../metal/index.ts";

export interface DotRowProps {
  /** How many dots. */
  count: number;
  /** 0 to 1: how many are lit, from the left. */
  value: number;
  /** Centre to centre, in points. */
  pitch?: number;
  /** As a share of the pitch. */
  radius?: number;
  lit: string;
  unlit: string;
  /** A ringed dot at this value (the battery's charge limit). */
  mark?: number;
}

/** The two masks' markup: lit dots, unlit dots (a ring for the mark). */
export function dotRowMarkup(count: number, value: number, pitch: number, radius: number, mark?: number): { lit: string; unlit: string } {
  const lit = Math.round(count * Math.min(1, Math.max(0, value)));
  const markAt = mark === undefined ? -1 : Math.round(count * mark) - 1;
  const r = radius * pitch;
  const on: string[] = [];
  const off: string[] = [];
  for (let i = 0; i < count; i++) {
    const cx = ((i + 0.5) * pitch).toFixed(2);
    const cy = (pitch / 2).toFixed(2);
    if (i === markAt) (i < lit ? on : off).push(`<circle cx="${cx}" cy="${cy}" r="${(r * 0.85).toFixed(2)}" fill="none" stroke="#000" stroke-width="1.2"/>`);
    else (i < lit ? on : off).push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}" fill="#000"/>`);
  }
  const svg = (body: string[]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count * pitch} ${pitch}">${body.join("")}</svg>`;
  return { lit: svg(on), unlit: svg(off) };
}

/** The padding that makes `<Dots>`' box Dashi's: `count·pitch` across, `pitch` down. */
export function dotsInset(pitch: number, r: number): number {
  return Math.max(0, pitch / 2 - r);
}

/** A row of dots filling from the left, in two colours: one `<Dots>`, or three nodes on an older host. */
export const DotRow = memo(function DotRow({ count, value, pitch = 7, radius = 0.36, lit, unlit, mark }: DotRowProps) {
  const step = Math.round(count * Math.min(1, Math.max(0, value)));
  const { dots } = useHostAbilities();
  if (dots) {
    const r = radius * pitch;
    const markAt = mark === undefined ? -1 : Math.round(count * mark) - 1;
    const head = markAt >= 0 ? { head: markAt, headRing: true, headColor: markAt < step ? lit : unlit } : {};
    return (
      <View style={{ padding: dotsInset(pitch, r) }}>
        <Dots count={count} pitch={pitch} radius={r} lit={step} color={lit} unlitColor={unlit} {...head} />
      </View>
    );
  }
  const markup = dotRowMarkup(count, step / count, pitch, radius, mark);
  const width = count * pitch;
  return (
    <View style={{ width, height: pitch }}>
      <View style={{ position: "absolute", left: 0, top: 0 }}>
        <Svg markup={markup.unlit} width={width} height={pitch} color={unlit} />
      </View>
      <View style={{ position: "absolute", left: 0, top: 0 }}>
        <Svg markup={markup.lit} width={width} height={pitch} color={lit} />
      </View>
    </View>
  );
});
