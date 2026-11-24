/**
 * The name cell: an app's disclosure chevron (VO-8: a chevron, in ink) and
 * icon, its name and how many processes it has; a process under its app
 * indented; a process no app started on its own, by its name.
 */

import { CHEVRON_DOWN, CHEVRON_RIGHT, type Column, SPACE, TYPE, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { AppIcon } from "../../../../src/shared/apps/index.ts";
import type { Line } from "../lines.ts";

/** A level's indent, the app icon, and the disclosure's column (its chevron and the room it is pressed in). */
const INDENT = 18;
const ICON = 16;
const DISCLOSURE = { width: 14, height: 18, chevron: 11 } as const;

/** The name column of a tab: the same column, its cell the name cell. */
export function namedColumn(column: Column<Line>, onToggle: (line: Line) => void): Column<Line> {
  return { ...column, cell: (line, chosen) => <NameCell line={line} selected={chosen} onToggle={onToggle} /> };
}

export function NameCell({ line, selected, onToggle }: { line: Line; selected: boolean; onToggle: (line: Line) => void }) {
  const colors = useColors();
  const ink = selected ? colors.onSelection : line.own ? colors.text : colors.textMuted;
  const quiet = selected ? colors.onSelection : colors.textMuted;
  return (
    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACE.xs, paddingLeft: line.depth * INDENT }}>
      {line.expandable ? (
        <View
          testID={`toggle:${line.key}`}
          accessibilityRole="button"
          accessibilityLabel={line.expanded ? `Hide ${line.name}’s processes` : `Show ${line.name}’s processes`}
          onPress={() => onToggle(line)}
          // A disclosure triangle, bare as a list's are: the row is what lights under the pointer.
          style={{ width: DISCLOSURE.width, height: DISCLOSURE.height, flexShrink: 0, alignItems: "center", justifyContent: "center" }}
        >
          <Svg markup={line.expanded ? CHEVRON_DOWN : CHEVRON_RIGHT} size={DISCLOSURE.chevron} color={ink} />
        </View>
      ) : (
        // Where the chevron would be, on every line: an app's processes sit one step in from its name, not level with the lines around.
        <View style={{ width: DISCLOSURE.width, flexShrink: 0 }} />
      )}
      <View style={{ width: ICON, height: ICON, flexShrink: 0 }}>{line.icon && <AppIcon source={line.icon} style={{ width: ICON, height: ICON }} />}</View>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: ink }}>
          {line.name}
        </Text>
      </View>
      {line.kind === "app" && line.members.length > 1 && (
        <View style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: quiet }}>
            {String(line.members.length)}
          </Text>
        </View>
      )}
    </View>
  );
}
