/**
 * The name cell: an app's disclosure chevron (CP-8: a chevron, in ink) and
 * icon, its name and how many processes it has; a process under its app
 * indented; a process no app started on its own, by its name.
 */

import { CHEVRON_DOWN, useColors } from "@dashi/ui";
import { Image, Svg, Text, View } from "@mirinjs/metal";
import type { Line } from "./lines.ts";

/** Pointing right: closed. */
const CHEVRON_RIGHT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6.5 4.5l3.5 3.5-3.5 3.5" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const INDENT = 18;
const ICON = 16;

export function NameCell({ line, selected, onToggle }: { line: Line; selected: boolean; onToggle: (line: Line) => void }) {
  const colors = useColors();
  const ink = selected ? colors.onSelection : line.own ? colors.text : colors.textMuted;
  const quiet = selected ? colors.onSelection : colors.textMuted;
  return (
    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: line.depth * INDENT }}>
      {line.expandable ? (
        <View
          testID={`toggle:${line.key}`}
          accessibilityRole="button"
          accessibilityLabel={line.expanded ? `Hide ${line.name}’s processes` : `Show ${line.name}’s processes`}
          onPress={() => onToggle(line)}
          style={{ width: 14, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 4, hoverBackgroundColor: colors.button }}
        >
          <Svg markup={line.expanded ? CHEVRON_DOWN : CHEVRON_RIGHT} size={11} color={ink} />
        </View>
      ) : (
        // Where the chevron would be, on every line: an app's processes sit one step in from its name, not level with the lines around.
        <View style={{ width: 14, flexShrink: 0 }} />
      )}
      <View style={{ width: ICON, height: ICON, flexShrink: 0 }}>{line.icon && <Image source={line.icon} style={{ width: ICON, height: ICON }} />}</View>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 12, color: ink }}>
          {line.name}
        </Text>
      </View>
      {line.kind === "app" && line.members.length > 1 && (
        <View style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 11, color: quiet }}>
            {String(line.members.length)}
          </Text>
        </View>
      )}
    </View>
  );
}
