/**
 * An app on a row's knob (Sound's mixer, Clipboard's left-out apps): its
 * icon, or its name's first letter on its tint.
 */

import { ON_TINT, pill, TYPE, tintFor, useControlColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { AppIcon } from "../../../shared/apps/index.ts";
import { PAGE } from "../row.tsx";

/** The icon's size on the knob. */
const ICON = 24;

/**
 * The app's icon on the row's 40 knob; an app without one shows its name's
 * first letter on its tint (a blank square read as an unticked box: SE-A43).
 */
export function AppDisc({ icon, name }: { icon: string | undefined; name: string }) {
  const colors = useControlColors();
  const letter = icon === undefined;
  return (
    <View
      style={{
        width: PAGE.knob,
        height: PAGE.knob,
        flexShrink: 0,
        borderRadius: pill(PAGE.knob),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: letter ? tintFor(name) : colors.knobRest,
      }}
    >
      {letter ? (
        <Text style={{ fontSize: TYPE.panel.name.size, fontWeight: WEIGHT.semibold, color: ON_TINT }}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
      ) : (
        <AppIcon source={icon} style={{ width: ICON, height: ICON }} />
      )}
    </View>
  );
}
