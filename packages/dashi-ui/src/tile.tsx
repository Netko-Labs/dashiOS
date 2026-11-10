/** A glyph on a rounded tile of its color. */

import { Svg, View } from "@mirinjs/metal";

/** A tile's side unless a caller asks for another (a sidebar's, Settings' panes). */
export const TILE_SIZE = 22;

/** A glyph on a rounded tile of its color: the sidebar's icons and the About logo. */
export function Tile({ glyph, tint, size = TILE_SIZE }: { glyph: string; tint: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.27, alignItems: "center", justifyContent: "center", backgroundColor: tint }}>
      <Svg markup={glyph} size={Math.round(size * 0.64)} color="#ffffff" />
    </View>
  );
}
