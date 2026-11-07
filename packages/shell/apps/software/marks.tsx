/**
 * The two trust marks, kept apart because two different authorities stand
 * behind them: Flathub's verified check (its blue seal, the `verified`
 * token: Flathub checked who publishes the app) and Dashi's reviewed seal
 * (the bowl, in ink: Dashi's maintainers read the applet's code). Kombu is
 * the person's color, so neither wears it.
 */

import { useColors } from "@dashi/ui";
import { Svg, View } from "@mirinjs/metal";
import { REVIEWED, VERIFIED, VERIFIED_CHECK } from "./glyphs.ts";

/** A check in a seal: Flathub has verified who publishes the app. */
export function VerifiedBadge({ size = 14 }: { size?: number }) {
  const colors = useColors();
  return (
    <View testID="mark:verified" style={{ width: size, height: size, alignItems: "center", justifyContent: "center", position: "relative" }}>
      <Svg markup={VERIFIED} size={size} color={colors.verified} />
      <View style={{ position: "absolute", left: 0, top: 0, width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg markup={VERIFIED_CHECK} size={size * 0.8} color="#ffffff" />
      </View>
    </View>
  );
}

/** Dashi's bowl: Dashi's maintainers reviewed the applet. */
export function ReviewedSeal({ size = 14 }: { size?: number }) {
  const colors = useColors();
  return (
    <View testID="mark:reviewed" style={{ width: size, height: size }}>
      <Svg markup={REVIEWED} size={size} color={colors.text} />
    </View>
  );
}
