/**
 * The scrim round a glass sheet (UI-5, decisions.md D812). The compositor draws glass behind the
 * surface that wears it, so a scrim painted under the card would lie over the card's own glass,
 * darkening it (55 % black in Dark). Instead the scrim is painted everywhere but the card: four bands
 * round it, and in each corner the part outside the card's rounded corner.
 */

import { type Bounds, Svg, View } from "@mirinjs/metal";

/** The outside of a quarter circle of radius 1 in a unit square at its top left; turned for the other corners. */
const CORNER_PATHS = {
  topLeft: "M0 0H1A1 1 0 0 0 0 1Z",
  topRight: "M1 0H0A1 1 0 0 1 1 1Z",
  bottomLeft: "M0 1V0A1 1 0 0 0 1 1Z",
  bottomRight: "M1 1H0A1 1 0 0 0 1 0Z",
} as const;

type Corner = keyof typeof CORNER_PATHS;

/** A corner's piece as SVG markup, in `currentColor` (Svg's `color`). */
export function cornerMarkup(corner: Corner): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path fill="currentColor" d="${CORNER_PATHS[corner]}"/></svg>`;
}

/** The four bands round `card` (its parent's coordinates): above, below, and left and right of it. */
export function bandsAround(
  card: Bounds,
): Array<{ key: string; style: { left?: number; right?: number; top?: number; bottom?: number; width?: number; height?: number } }> {
  return [
    { key: "above", style: { left: 0, right: 0, top: 0, height: card.y } },
    { key: "below", style: { left: 0, right: 0, top: card.y + card.height, bottom: 0 } },
    { key: "left", style: { left: 0, top: card.y, width: card.x, height: card.height } },
    { key: "right", style: { left: card.x + card.width, right: 0, top: card.y, height: card.height } },
  ];
}

/** The scrim, `color`, everywhere but `card` (null until it is laid out: the whole scrim, under nothing yet). */
export function ScrimAround({ color, card, radius }: { color: string; card: Bounds | null; radius: number }) {
  if (card === null) return <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: color }} />;
  const corners: Array<[Corner, number, number]> = [
    ["topLeft", card.x, card.y],
    ["topRight", card.x + card.width - radius, card.y],
    ["bottomLeft", card.x, card.y + card.height - radius],
    ["bottomRight", card.x + card.width - radius, card.y + card.height - radius],
  ];
  return (
    <>
      {bandsAround(card).map(({ key, style }) => (
        <View key={key} testID={`scrim:${key}`} style={{ position: "absolute", ...style, backgroundColor: color }} />
      ))}
      {corners.map(([corner, left, top]) => (
        <View key={corner} style={{ position: "absolute", left, top, width: radius, height: radius }}>
          <Svg markup={cornerMarkup(corner)} size={radius} color={color} />
        </View>
      ))}
    </>
  );
}
