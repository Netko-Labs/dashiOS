/** The consent sheet's permissions (consent.tsx): what this call needs, in full, and the rest as a grid of one-line ticks. */

import { useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import type { Ask } from "./agents/index.ts";

const CHECK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" stroke="#000" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** A permission in the grid of the others: one line. */
const CELL = 24;

function CheckBox({ on }: { on: boolean }) {
  const colors = useColors();
  return (
    <View
      style={{
        width: 16,
        height: 16,
        flexShrink: 0,
        borderRadius: 4,
        borderWidth: on ? 0 : 1.5,
        borderColor: colors.checkbox,
        backgroundColor: on ? colors.selection : "#00000000",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && <Svg markup={CHECK} size={12} color="#ffffff" />}
    </View>
  );
}

interface ScopesProps {
  scopes: Ask["scopes"];
  /** The ids ticked. */
  checked: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

/** What this call needs: each with its words, first, so it is never out of sight. */
export function NeededScopes({ scopes, checked, onToggle }: ScopesProps) {
  const colors = useColors();
  return (
    <>
      {scopes.map((scope, index) => (
        <View
          key={scope.id}
          testID={`consent-scope:${scope.id}`}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 10,
            paddingTop: 6,
            paddingBottom: 6,
            borderTopWidth: index === 0 ? 0 : 1,
            borderColor: colors.separator,
          }}
          onPress={() => onToggle(scope.id)}
        >
          <View style={{ marginTop: 1 }}>
            <CheckBox on={checked.has(scope.id)} />
          </View>
          <View style={{ flex: 1, flexDirection: "column", gap: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{scope.label}</Text>
              <Text style={{ fontSize: 11, color: colors.agentInk }}>needed now</Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>{scope.detail}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

/** Permissions as one line each, two to a row; pointing at one says what it allows. */
export function ScopeGrid({ scopes, checked, onToggle, onPoint, testID }: ScopesProps & { onPoint: (id: string, hovered: boolean) => void; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ display: "grid", gridTemplateColumns: ["1fr", "1fr"], columnGap: 12, flexShrink: 0 }}>
      {scopes.map((scope) => (
        <View
          key={scope.id}
          testID={`consent-scope:${scope.id}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            height: CELL,
            minWidth: 0,
            borderRadius: 6,
            hoverBackgroundColor: colors.button,
          }}
          onHoverChange={(hovered) => onPoint(scope.id, hovered)}
          onPress={() => onToggle(scope.id)}
        >
          <CheckBox on={checked.has(scope.id)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
              {scope.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
